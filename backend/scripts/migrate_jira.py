"""
Jira Cloud + Confluence -> Weave 마이그레이션 스크립트

사용법:
    pip install requests beautifulsoup4 psycopg2-binary

    python backend/scripts/migrate_jira.py \
        --jira-domain yourcompany \
        --jira-email user@example.com \
        --jira-token YOUR_API_TOKEN \
        --project-key PROJ \
        --confluence-space-key PROJ \
        --fallback-user-id 1 \
        --dry-run
"""
import argparse
import logging
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from sqlalchemy import create_engine, text

# backend/ 디렉토리를 path에 추가
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import DATABASE_URL_SYNC

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("migrate")

# ---------------------------------------------------------------------------
# 매핑 상수
# ---------------------------------------------------------------------------
STATUS_MAP = {
    "to do": "todo", "open": "todo", "backlog": "todo",
    "reopened": "todo", "new": "todo",
    "in progress": "in_progress", "in review": "in_progress",
    "in development": "in_progress",
    "done": "done", "closed": "done", "resolved": "done",
}

PRIORITY_MAP = {
    "highest": "high", "high": "high",
    "medium": "medium",
    "low": "low", "lowest": "low",
}

TASK_TYPE_MAP = {
    "story": "story", "bug": "bug", "task": "task",
    "sub-task": "task", "subtask": "task",
}

SPRINT_STATUS_MAP = {
    "future": "future", "active": "active", "closed": "completed",
}

EPIC_STATUS_MAP = STATUS_MAP  # 동일 매핑

# 라벨 색상 팔레트 (순환 할당)
LABEL_COLORS = [
    "#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6",
    "#EC4899", "#06B6D4", "#F97316", "#6366F1", "#14B8A6",
]


# ---------------------------------------------------------------------------
# ADF (Atlassian Document Format) -> 텍스트 변환
# ---------------------------------------------------------------------------
def adf_to_text(node):
    """ADF JSON 노드에서 텍스트 추출"""
    if not node or not isinstance(node, dict):
        return ""
    if node.get("type") == "text":
        return node.get("text", "")
    parts = []
    for child in node.get("content", []):
        parts.append(adf_to_text(child))
    return "\n".join(filter(None, parts))


# ---------------------------------------------------------------------------
# Confluence 저장 포맷 -> TipTap HTML 변환
# ---------------------------------------------------------------------------
def confluence_to_tiptap(storage_html):
    """Confluence XHTML 저장 포맷을 TipTap이 이해하는 HTML로 변환"""
    if not storage_html:
        return ""
    soup = BeautifulSoup(storage_html, "html.parser")

    # ac:structured-macro -> 매크로 이름을 텍스트로 표시
    for macro in soup.find_all("ac:structured-macro"):
        name = macro.get("ac:name", "unknown")
        # 코드 블록 매크로는 <pre><code>로 변환
        if name == "code":
            body = macro.find("ac:plain-text-body")
            code_text = body.get_text() if body else ""
            pre = soup.new_tag("pre")
            code = soup.new_tag("code")
            code.string = code_text
            pre.append(code)
            macro.replace_with(pre)
        else:
            # 기타 매크로는 내용만 추출
            inner = macro.get_text(strip=True)
            if inner:
                p = soup.new_tag("p")
                p.string = inner
                macro.replace_with(p)
            else:
                macro.decompose()

    # ac:image -> <img> (src는 플레이스홀더)
    for img in soup.find_all("ac:image"):
        attachment = img.find("ri:attachment")
        filename = attachment.get("ri:filename", "image") if attachment else "image"
        new_img = soup.new_tag("img", alt=filename, src=f"#migrated:{filename}")
        img.replace_with(new_img)

    # ac:link -> <a>
    for link in soup.find_all("ac:link"):
        text_el = link.find("ac:plain-text-link-body") or link.find("ri:page")
        link_text = text_el.get_text() if text_el else "link"
        a = soup.new_tag("a", href="#")
        a.string = link_text
        link.replace_with(a)

    # ac:task-list -> <ul data-type="taskList">
    for task_list in soup.find_all("ac:task-list"):
        ul = soup.new_tag("ul")
        ul["data-type"] = "taskList"
        for task in task_list.find_all("ac:task"):
            li = soup.new_tag("li")
            li["data-type"] = "taskItem"
            status = task.find("ac:task-status")
            if status and status.get_text().strip().lower() == "complete":
                li["data-checked"] = "true"
            body = task.find("ac:task-body")
            if body:
                li.string = body.get_text()
            ul.append(li)
        task_list.replace_with(ul)

    # 나머지 ac:*, ri:* 태그 제거 (내용은 보존)
    for tag in soup.find_all(True):
        if tag.name and (":" in tag.name):
            tag.unwrap()

    return str(soup)


# ---------------------------------------------------------------------------
# Jira API 클라이언트
# ---------------------------------------------------------------------------
class JiraClient:
    def __init__(self, domain, email, token):
        self.base = f"https://{domain}.atlassian.net"
        self.session = requests.Session()
        self.session.auth = (email, token)
        self.session.headers["Accept"] = "application/json"
        self.session.headers["Content-Type"] = "application/json"

    def _request(self, method, url, **kwargs):
        """rate limit 대응 포함 요청"""
        for attempt in range(5):
            resp = self.session.request(method, url, **kwargs)
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 2 ** attempt))
                log.warning(f"Rate limited, {wait}초 대기...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp
        resp.raise_for_status()  # 마지막 시도 실패 시

    def verify(self):
        """인증 확인"""
        resp = self._request("GET", f"{self.base}/rest/api/3/myself")
        data = resp.json()
        log.info(f"Jira 인증 성공: {data.get('displayName')} ({data.get('emailAddress')})")
        return data

    def get_project(self, key):
        resp = self._request("GET", f"{self.base}/rest/api/3/project/{key}")
        return resp.json()

    def search_issues(self, jql, fields=None):
        """JQL로 이슈 검색 (페이지네이션 자동)"""
        start = 0
        max_results = 100
        default_fields = [
            "summary", "description", "status", "priority", "issuetype",
            "assignee", "reporter", "labels", "created", "updated",
            "duedate", "parent", "comment",
            "customfield_10014",  # Epic Link (일반적)
            "customfield_10015",  # Start date
        ]
        fields = fields or default_fields
        while True:
            resp = self._request("POST", f"{self.base}/rest/api/3/search", json={
                "jql": jql,
                "startAt": start,
                "maxResults": max_results,
                "fields": fields,
            })
            data = resp.json()
            yield from data.get("issues", [])
            total = data.get("total", 0)
            start += max_results
            if start >= total:
                break
            log.info(f"  이슈 {start}/{total} 로드 중...")

    def get_boards(self, project_key):
        """프로젝트의 보드 목록"""
        resp = self._request("GET", f"{self.base}/rest/agile/1.0/board",
                             params={"projectKeyOrId": project_key})
        return resp.json().get("values", [])

    def get_sprints(self, board_id):
        """보드의 스프린트 목록 (페이지네이션)"""
        start = 0
        while True:
            resp = self._request("GET",
                                 f"{self.base}/rest/agile/1.0/board/{board_id}/sprint",
                                 params={"startAt": start, "maxResults": 50})
            data = resp.json()
            yield from data.get("values", [])
            if data.get("isLast", True):
                break
            start += len(data.get("values", []))

    def get_sprint_issues(self, sprint_id):
        """스프린트에 속한 이슈 키 목록"""
        start = 0
        keys = []
        while True:
            resp = self._request("GET",
                                 f"{self.base}/rest/agile/1.0/sprint/{sprint_id}/issue",
                                 params={"startAt": start, "maxResults": 100,
                                         "fields": "key"})
            data = resp.json()
            for issue in data.get("issues", []):
                keys.append(issue["key"])
            total = data.get("total", 0)
            start += 100
            if start >= total:
                break
        return keys

    def get_confluence_space(self, space_key):
        """Confluence 스페이스 조회"""
        resp = self._request("GET", f"{self.base}/wiki/api/v2/spaces",
                             params={"keys": space_key})
        results = resp.json().get("results", [])
        return results[0] if results else None

    def get_confluence_pages(self, space_id):
        """Confluence 스페이스의 전체 페이지 (페이지네이션)"""
        url = f"{self.base}/wiki/api/v2/spaces/{space_id}/pages"
        params = {"limit": 50, "body-format": "storage"}
        while url:
            resp = self._request("GET", url, params=params)
            data = resp.json()
            yield from data.get("results", [])
            next_link = data.get("_links", {}).get("next")
            url = f"{self.base}{next_link}" if next_link else None
            params = None  # next URL에 파라미터 포함


# ---------------------------------------------------------------------------
# ID 매핑
# ---------------------------------------------------------------------------
class IDMapper:
    def __init__(self):
        self.users = {}       # jira_account_id -> weave_user_id
        self.epics = {}       # jira_epic_key -> weave_epic_id
        self.sprints = {}     # jira_sprint_id -> weave_sprint_id
        self.tasks = {}       # jira_issue_key -> weave_task_id
        self.labels = {}      # label_name -> weave_label_id
        self.pages = {}       # confluence_page_id -> weave_page_id


# ---------------------------------------------------------------------------
# 마이그레이터
# ---------------------------------------------------------------------------
class Migrator:
    def __init__(self, jira: JiraClient, db_url: str, project_key: str,
                 confluence_space_key: str, fallback_user_id: int, dry_run: bool):
        self.jira = jira
        self.engine = create_engine(db_url)
        self.project_key = project_key
        self.confluence_space_key = confluence_space_key
        self.fallback_user_id = fallback_user_id
        self.dry_run = dry_run
        self.mapper = IDMapper()
        self.user_email_map = {}  # email -> weave_user_id
        self.branch_id = None
        self.stats = {
            "branch": 0, "labels": 0, "epics": 0, "sprints": 0,
            "tasks": 0, "tasks_failed": 0, "comments": 0,
            "canvas": 0, "pages": 0,
        }

    def resolve_user(self, jira_user):
        """Jira 유저 -> Weave user_id (매칭 실패 시 fallback)"""
        if not jira_user:
            return self.fallback_user_id
        account_id = jira_user.get("accountId", "")
        if account_id in self.mapper.users:
            return self.mapper.users[account_id]
        email = jira_user.get("emailAddress", "")
        user_id = self.user_email_map.get(email, self.fallback_user_id)
        self.mapper.users[account_id] = user_id
        if user_id == self.fallback_user_id and email:
            log.warning(f"  유저 매칭 실패: {email} -> fallback 사용")
        return user_id

    def map_status(self, jira_status_name):
        return STATUS_MAP.get(jira_status_name.lower(), "todo")

    def map_priority(self, jira_priority_name):
        if not jira_priority_name:
            return "medium"
        return PRIORITY_MAP.get(jira_priority_name.lower(), "medium")

    def map_task_type(self, jira_type_name):
        return TASK_TYPE_MAP.get(jira_type_name.lower(), "task")

    def run(self):
        log.info("=" * 60)
        log.info("Jira -> Weave 마이그레이션 시작")
        if self.dry_run:
            log.info("(DRY RUN - 실제 데이터 저장 안 함)")
        log.info("=" * 60)

        with self.engine.connect() as conn:
            # 유저 맵 로드
            rows = conn.execute(text('SELECT user_id, email FROM "user"')).fetchall()
            self.user_email_map = {r.email: r.user_id for r in rows}
            log.info(f"Weave 유저 {len(self.user_email_map)}명 로드")

            try:
                self._migrate_branch(conn)
                self._migrate_epics(conn)
                self._migrate_sprints(conn)
                self._migrate_tasks(conn)
                self._migrate_comments(conn)
                if self.confluence_space_key:
                    self._migrate_confluence(conn)

                if self.dry_run:
                    conn.rollback()
                    log.info("DRY RUN 완료 - ROLLBACK")
                else:
                    conn.commit()
                    log.info("COMMIT 완료")
            except Exception:
                conn.rollback()
                log.exception("마이그레이션 실패 - ROLLBACK")
                raise

        self._print_summary()

    # -----------------------------------------------------------------------
    # Phase 1: Branch
    # -----------------------------------------------------------------------
    def _migrate_branch(self, conn):
        log.info("\n[Phase 1] Branch 생성...")
        project = self.jira.get_project(self.project_key)

        # 이미 같은 key의 branch가 있는지 확인
        existing = conn.execute(
            text("SELECT branch_id FROM branch WHERE key = :key"),
            {"key": project["key"]}
        ).fetchone()
        if existing:
            self.branch_id = existing.branch_id
            log.info(f"  기존 Branch 사용: {self.branch_id}")
            return

        result = conn.execute(text("""
            INSERT INTO branch (branch_name, key, description, visibility, created_by)
            VALUES (:name, :key, :desc, 'private', :user_id)
            RETURNING branch_id
        """), {
            "name": project["name"],
            "key": project["key"],
            "desc": project.get("description", ""),
            "user_id": self.fallback_user_id,
        })
        self.branch_id = result.scalar_one()

        # branch_member
        conn.execute(text("""
            INSERT INTO branch_member (branch_id, user_id, role)
            VALUES (:bid, :uid, 'owner')
        """), {"bid": self.branch_id, "uid": self.fallback_user_id})

        # task_sequence
        conn.execute(text("""
            INSERT INTO task_sequence (branch_id, last_number)
            VALUES (:bid, 0)
        """), {"bid": self.branch_id})

        self.stats["branch"] = 1
        log.info(f"  Branch 생성: {project['name']} (id={self.branch_id})")

    # -----------------------------------------------------------------------
    # Phase 3: Epics
    # -----------------------------------------------------------------------
    def _migrate_epics(self, conn):
        log.info("\n[Phase 3] Epic 마이그레이션...")
        jql = f"project={self.project_key} AND issuetype=Epic ORDER BY created ASC"
        count = 0
        for issue in self.jira.search_issues(jql):
            fields = issue["fields"]
            status = self.map_status(fields["status"]["name"])
            result = conn.execute(text("""
                INSERT INTO epic (branch_id, epic_name, description, status,
                                  color, start_date, due_date, created_by)
                VALUES (:bid, :name, :desc, :status, :color,
                        :start, :due, :uid)
                RETURNING epic_id
            """), {
                "bid": self.branch_id,
                "name": fields["summary"],
                "desc": adf_to_text(fields.get("description")),
                "status": status,
                "color": LABEL_COLORS[count % len(LABEL_COLORS)],
                "start": fields.get("customfield_10015"),
                "due": fields.get("duedate"),
                "uid": self.resolve_user(fields.get("reporter")),
            })
            epic_id = result.scalar_one()
            self.mapper.epics[issue["key"]] = epic_id
            count += 1

        self.stats["epics"] = count
        log.info(f"  Epic {count}개 마이그레이션 완료")

    # -----------------------------------------------------------------------
    # Phase 4: Sprints
    # -----------------------------------------------------------------------
    def _migrate_sprints(self, conn):
        log.info("\n[Phase 4] Sprint 마이그레이션...")
        boards = self.jira.get_boards(self.project_key)
        if not boards:
            log.info("  보드 없음 - 스킵")
            return

        # 스프린트 -> 이슈 키 매핑도 수집
        self._sprint_issue_keys = {}  # sprint_id -> set(issue_keys)
        count = 0
        for board in boards:
            for sprint in self.jira.get_sprints(board["id"]):
                status = SPRINT_STATUS_MAP.get(sprint.get("state", ""), "future")
                result = conn.execute(text("""
                    INSERT INTO sprint (branch_id, sprint_name, goal,
                                        start_date, end_date, status, created_by)
                    VALUES (:bid, :name, :goal, :start, :end, :status, :uid)
                    RETURNING sprint_id
                """), {
                    "bid": self.branch_id,
                    "name": sprint["name"],
                    "goal": sprint.get("goal", ""),
                    "start": sprint.get("startDate"),
                    "end": sprint.get("endDate"),
                    "status": status,
                    "uid": self.fallback_user_id,
                })
                weave_sprint_id = result.scalar_one()
                jira_sprint_id = sprint["id"]
                self.mapper.sprints[jira_sprint_id] = weave_sprint_id

                # 이 스프린트에 속한 이슈 키 수집
                issue_keys = self.jira.get_sprint_issues(jira_sprint_id)
                self._sprint_issue_keys[jira_sprint_id] = set(issue_keys)
                count += 1

        self.stats["sprints"] = count
        log.info(f"  Sprint {count}개 마이그레이션 완료")

    # -----------------------------------------------------------------------
    # Phase 5: Tasks (2-pass)
    # -----------------------------------------------------------------------
    def _migrate_tasks(self, conn):
        log.info("\n[Phase 5] Task 마이그레이션...")

        # 모든 이슈 가져오기 (Epic 제외)
        jql = (f"project={self.project_key} AND issuetype != Epic "
               f"ORDER BY created ASC")
        all_issues = list(self.jira.search_issues(jql))
        log.info(f"  총 {len(all_issues)}개 이슈 로드")

        # 라벨 수집 + 생성
        self._collect_and_create_labels(conn, all_issues)

        # 스프린트-이슈 역방향 매핑 생성
        issue_sprint_map = {}  # issue_key -> jira_sprint_id
        for jira_sid, keys in getattr(self, "_sprint_issue_keys", {}).items():
            for k in keys:
                issue_sprint_map[k] = jira_sid

        # Pass 1: 일반 이슈 (Sub-task 제외)
        regular = [i for i in all_issues
                   if i["fields"]["issuetype"]["name"].lower() not in ("sub-task", "subtask")]
        subtasks = [i for i in all_issues
                    if i["fields"]["issuetype"]["name"].lower() in ("sub-task", "subtask")]

        log.info(f"  Pass 1: 일반 이슈 {len(regular)}개")
        for issue in regular:
            self._insert_task(conn, issue, issue_sprint_map)

        # Pass 2: Sub-task
        log.info(f"  Pass 2: Sub-task {len(subtasks)}개")
        for issue in subtasks:
            self._insert_task(conn, issue, issue_sprint_map)

        log.info(f"  Task {self.stats['tasks']}개 완료, {self.stats['tasks_failed']}개 실패")

    def _collect_and_create_labels(self, conn, issues):
        """이슈에서 고유 라벨 수집 후 DB 생성"""
        label_names = set()
        for issue in issues:
            for label in issue["fields"].get("labels", []):
                label_names.add(label)

        if not label_names:
            return

        log.info(f"  라벨 {len(label_names)}개 생성 중...")
        for i, name in enumerate(sorted(label_names)):
            result = conn.execute(text("""
                INSERT INTO label (branch_id, label_name, color)
                VALUES (:bid, :name, :color)
                RETURNING label_id
            """), {
                "bid": self.branch_id,
                "name": name,
                "color": LABEL_COLORS[i % len(LABEL_COLORS)],
            })
            self.mapper.labels[name] = result.scalar_one()

        self.stats["labels"] = len(label_names)

    def _insert_task(self, conn, issue, issue_sprint_map):
        """단일 이슈 -> Task 삽입"""
        try:
            fields = issue["fields"]
            key = issue["key"]

            # display_number 증가
            seq = conn.execute(text("""
                UPDATE task_sequence SET last_number = last_number + 1
                WHERE branch_id = :bid RETURNING last_number
            """), {"bid": self.branch_id})
            display_number = seq.scalar_one()

            # Epic 매핑
            epic_link = fields.get("customfield_10014")
            epic_id = None
            if epic_link:
                # customfield_10014는 epic의 key(문자열)일 수도, id일 수도 있음
                if isinstance(epic_link, str):
                    epic_id = self.mapper.epics.get(epic_link)
                elif isinstance(epic_link, dict):
                    epic_id = self.mapper.epics.get(epic_link.get("key"))

            # Sprint 매핑
            sprint_id = None
            jira_sprint_id = issue_sprint_map.get(key)
            if jira_sprint_id:
                sprint_id = self.mapper.sprints.get(jira_sprint_id)

            # Parent (Sub-task)
            parent_task_id = None
            parent = fields.get("parent")
            if parent:
                parent_task_id = self.mapper.tasks.get(parent["key"])

            task_type = self.map_task_type(fields["issuetype"]["name"])
            status = self.map_status(fields["status"]["name"])
            priority = self.map_priority(
                fields.get("priority", {}).get("name") if fields.get("priority") else None
            )
            created_by = self.resolve_user(fields.get("reporter"))

            result = conn.execute(text("""
                INSERT INTO task (branch_id, display_number, title, description,
                                  task_type, status, priority, epic_id, sprint_id,
                                  parent_task_id, start_date, due_date, created_by)
                VALUES (:bid, :dn, :title, :desc, :type, :status, :priority,
                        :eid, :sid, :pid, :start, :due, :uid)
                RETURNING task_id
            """), {
                "bid": self.branch_id,
                "dn": display_number,
                "title": fields["summary"],
                "desc": adf_to_text(fields.get("description")),
                "type": task_type,
                "status": status,
                "priority": priority,
                "eid": epic_id,
                "sid": sprint_id,
                "pid": parent_task_id,
                "start": fields.get("customfield_10015"),
                "due": fields.get("duedate"),
                "uid": created_by,
            })
            task_id = result.scalar_one()
            self.mapper.tasks[key] = task_id

            # 담당자
            assignee = fields.get("assignee")
            if assignee:
                user_id = self.resolve_user(assignee)
                conn.execute(text("""
                    INSERT INTO task_assignee (task_id, user_id, role)
                    VALUES (:tid, :uid, 'main')
                """), {"tid": task_id, "uid": user_id})

            # 라벨 연결
            for label_name in fields.get("labels", []):
                label_id = self.mapper.labels.get(label_name)
                if label_id:
                    conn.execute(text("""
                        INSERT INTO task_label (task_id, label_id)
                        VALUES (:tid, :lid)
                    """), {"tid": task_id, "lid": label_id})

            self.stats["tasks"] += 1

        except Exception:
            self.stats["tasks_failed"] += 1
            log.exception(f"  Task 삽입 실패: {issue.get('key', '?')}")

    # -----------------------------------------------------------------------
    # Phase 6: Comments
    # -----------------------------------------------------------------------
    def _migrate_comments(self, conn):
        log.info("\n[Phase 6] 댓글 마이그레이션...")
        count = 0
        for jira_key, task_id in self.mapper.tasks.items():
            # 이슈 내 댓글 확인 (search 시 이미 포함됨 - 별도 API 호출)
            try:
                resp = self.jira._request(
                    "GET", f"{self.jira.base}/rest/api/3/issue/{jira_key}/comment")
                comments = resp.json().get("comments", [])
                if not comments:
                    continue

                # task_issue 1개 생성
                first = comments[0]
                first_text = adf_to_text(first.get("body"))
                result = conn.execute(text("""
                    INSERT INTO task_issue (task_id, title, body, status, created_by)
                    VALUES (:tid, :title, :body, 'closed', :uid)
                    RETURNING issue_id
                """), {
                    "tid": task_id,
                    "title": "Jira 댓글",
                    "body": first_text,
                    "uid": self.resolve_user(first.get("author")),
                })
                issue_id = result.scalar_one()

                # 나머지 댓글 -> task_issue_comment
                for comment in comments[1:]:
                    body = adf_to_text(comment.get("body"))
                    conn.execute(text("""
                        INSERT INTO task_issue_comment (issue_id, author_id, content)
                        VALUES (:iid, :uid, :content)
                    """), {
                        "iid": issue_id,
                        "uid": self.resolve_user(comment.get("author")),
                        "content": body,
                    })

                count += len(comments)
            except Exception:
                log.exception(f"  댓글 마이그레이션 실패: {jira_key}")

        self.stats["comments"] = count
        log.info(f"  댓글 {count}개 마이그레이션 완료")

    # -----------------------------------------------------------------------
    # Phase 7: Confluence
    # -----------------------------------------------------------------------
    def _migrate_confluence(self, conn):
        log.info("\n[Phase 7] Confluence 마이그레이션...")

        space = self.jira.get_confluence_space(self.confluence_space_key)
        if not space:
            log.warning(f"  Confluence 스페이스 '{self.confluence_space_key}' 없음 - 스킵")
            return

        # Canvas 생성
        result = conn.execute(text("""
            INSERT INTO canvas (canvas_name, key, description, visibility,
                                branch_id, created_by)
            VALUES (:name, :key, :desc, 'private', :bid, :uid)
            RETURNING canvas_id
        """), {
            "name": space.get("name", self.confluence_space_key),
            "key": space.get("key", self.confluence_space_key),
            "desc": space.get("description", {}).get("plain", {}).get("value", ""),
            "bid": self.branch_id,
            "uid": self.fallback_user_id,
        })
        canvas_id = result.scalar_one()
        self.stats["canvas"] = 1

        # canvas_member
        conn.execute(text("""
            INSERT INTO canvas_member (canvas_id, user_id, role)
            VALUES (:cid, :uid, 'owner')
        """), {"cid": canvas_id, "uid": self.fallback_user_id})

        # 전체 페이지 로드
        pages = list(self.jira.get_confluence_pages(space["id"]))
        log.info(f"  Confluence 페이지 {len(pages)}개 로드")

        # 위상 정렬: 부모 먼저
        page_map = {p["id"]: p for p in pages}
        inserted = set()
        position_counter = {}  # parent_id -> position

        def insert_page(page):
            pid = page["id"]
            if pid in inserted:
                return
            parent_id_jira = page.get("parentId")
            parent_page_id = None
            if parent_id_jira:
                if parent_id_jira not in inserted and parent_id_jira in page_map:
                    insert_page(page_map[parent_id_jira])
                parent_page_id = self.mapper.pages.get(parent_id_jira)

            # position 계산
            parent_key = parent_page_id or 0
            pos = position_counter.get(parent_key, 0)
            position_counter[parent_key] = pos + 1

            # 콘텐츠 변환
            body = page.get("body", {})
            storage = body.get("storage", {}).get("value", "") if isinstance(body, dict) else ""
            content = confluence_to_tiptap(storage)

            try:
                result = conn.execute(text("""
                    INSERT INTO canvas_page (canvas_id, title, content,
                                             parent_page_id, position,
                                             created_by, updated_by, type)
                    VALUES (:cid, :title, :content, :ppid, :pos, :uid, :uid, 'document')
                    RETURNING page_id
                """), {
                    "cid": canvas_id,
                    "title": page.get("title", "Untitled"),
                    "content": content,
                    "ppid": parent_page_id,
                    "pos": pos,
                    "uid": self.fallback_user_id,
                })
                self.mapper.pages[pid] = result.scalar_one()
                self.stats["pages"] += 1
            except Exception:
                log.exception(f"  페이지 삽입 실패: {page.get('title', '?')}")

            inserted.add(pid)

        for page in pages:
            insert_page(page)

        log.info(f"  Canvas 1개, 페이지 {self.stats['pages']}개 마이그레이션 완료")

    # -----------------------------------------------------------------------
    # Summary
    # -----------------------------------------------------------------------
    def _print_summary(self):
        log.info("\n" + "=" * 60)
        log.info("마이그레이션 결과 요약")
        log.info("=" * 60)
        log.info(f"  Branch:     {self.stats['branch']}개 생성")
        log.info(f"  Labels:     {self.stats['labels']}개 생성")
        log.info(f"  Epics:      {self.stats['epics']}개 생성")
        log.info(f"  Sprints:    {self.stats['sprints']}개 생성")
        log.info(f"  Tasks:      {self.stats['tasks']}개 생성 ({self.stats['tasks_failed']}개 실패)")
        log.info(f"  Comments:   {self.stats['comments']}개 마이그레이션")
        log.info(f"  Canvas:     {self.stats['canvas']}개 생성")
        log.info(f"  Pages:      {self.stats['pages']}개 생성")
        log.info("=" * 60)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Jira Cloud -> Weave 마이그레이션")
    parser.add_argument("--jira-domain", required=True,
                        help="Jira Cloud 도메인 (예: yourcompany)")
    parser.add_argument("--jira-email", required=True,
                        help="Atlassian 계정 이메일")
    parser.add_argument("--jira-token", required=True,
                        help="Atlassian API 토큰")
    parser.add_argument("--project-key", required=True,
                        help="마이그레이션할 Jira 프로젝트 키 (예: PROJ)")
    parser.add_argument("--confluence-space-key", default=None,
                        help="Confluence 스페이스 키 (미지정 시 스킵)")
    parser.add_argument("--fallback-user-id", type=int, default=1,
                        help="매칭 안 되는 유저의 fallback user_id (기본: 1)")
    parser.add_argument("--dry-run", action="store_true",
                        help="실제 저장 없이 테스트 실행")
    parser.add_argument("--db-url", default=None,
                        help="DB URL 직접 지정 (미지정 시 config.py 사용)")
    args = parser.parse_args()

    # Jira 클라이언트
    jira = JiraClient(args.jira_domain, args.jira_email, args.jira_token)
    jira.verify()

    # DB URL
    db_url = args.db_url or DATABASE_URL_SYNC
    log.info(f"DB: {db_url.split('@')[-1] if '@' in db_url else '(local)'}")

    migrator = Migrator(
        jira=jira,
        db_url=db_url,
        project_key=args.project_key,
        confluence_space_key=args.confluence_space_key,
        fallback_user_id=args.fallback_user_id,
        dry_run=args.dry_run,
    )
    migrator.run()


if __name__ == "__main__":
    main()
