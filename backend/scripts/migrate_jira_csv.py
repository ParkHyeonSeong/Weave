"""
Jira CSV -> Weave 마이그레이션 스크립트

사용법:
    python backend/scripts/migrate_jira_csv.py \
        --csv-path "Jira (1).csv" \
        --branch-key AL \
        --fallback-user-id 1 \
        --dry-run
"""
import argparse
import csv
import logging
import re
import sys
from datetime import datetime, date
from pathlib import Path

from sqlalchemy import create_engine, text

# backend/ 디렉토리를 path에 추가
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import DATABASE_URL_SYNC

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("migrate_csv")

# ---------------------------------------------------------------------------
# CSV 컬럼 인덱스 (중복 헤더 때문에 인덱스 기반)
# ---------------------------------------------------------------------------
COL_TITLE = 0
COL_ISSUE_KEY = 1
COL_ISSUE_TYPE = 3
COL_STATUS = 4
COL_PRIORITY = 11
COL_ASSIGNEE = 13
COL_CREATED = 19
COL_UPDATED = 20
COL_DUE_DATE = 23
COL_LABEL = 25
COL_DESCRIPTION = 26
COL_SPRINT_START = 48  # 48~52 (5개 스프린트 컬럼)
COL_SPRINT_END = 52
COL_START_DATE = 53
COL_PARENT_KEY = 75

# ---------------------------------------------------------------------------
# 매핑 상수
# ---------------------------------------------------------------------------
STATUS_MAP = {
    "해야 할 일": "todo",
    "진행 중": "in_progress",
    "완료": "done",
}

PRIORITY_MAP = {
    "highest": "urgent",
    "high": "high",
    "medium": "medium",
    "low": "low",
    "lowest": "low",
}

# 에픽 제외, task_type_config에 추가할 유형들
TASK_TYPE_DEFS = {
    "experiment":  ("Experiment",  "FlaskConical", "#8B5CF6"),
    "feature":     ("Feature",     "Sparkles",     "#3B82F6"),
    "research":    ("Research",    "Search",       "#06B6D4"),
    "issue":       ("Issue",       "AlertCircle",  "#F97316"),
    "fix":         ("Fix",         "Wrench",       "#F59E0B"),
    "refactor":    ("Refactor",    "RefreshCw",    "#14B8A6"),
    "hotfix":      ("Hotfix",      "Flame",        "#EF4444"),
    "style":       ("Style",       "Palette",      "#EC4899"),
}

LABEL_COLORS = [
    "#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6",
    "#EC4899", "#06B6D4", "#F97316", "#6366F1", "#14B8A6",
]

EPIC_COLORS = LABEL_COLORS  # 순환 할당


# ---------------------------------------------------------------------------
# 한국어 날짜 파싱
# ---------------------------------------------------------------------------
KOREAN_MONTH = {
    "1월": 1, "2월": 2, "3월": 3, "4월": 4, "5월": 5, "6월": 6,
    "7월": 7, "8월": 8, "9월": 9, "10월": 10, "11월": 11, "12월": 12,
}


def parse_korean_datetime(s):
    """'09/3월/26 10:38 오전' -> datetime 또는 None"""
    s = s.strip()
    if not s:
        return None
    try:
        # 패턴: DD/M월/YY H:MM 오전/오후
        m = re.match(r"(\d{1,2})/(\d{1,2}월)/(\d{2})\s+(\d{1,2}):(\d{2})\s+(오전|오후)", s)
        if not m:
            return None
        day = int(m.group(1))
        month = KOREAN_MONTH.get(m.group(2))
        year = 2000 + int(m.group(3))
        hour = int(m.group(4))
        minute = int(m.group(5))
        ampm = m.group(6)

        if ampm == "오후" and hour != 12:
            hour += 12
        elif ampm == "오전" and hour == 12:
            hour = 0

        return datetime(year, month, day, hour, minute)
    except Exception:
        log.warning(f"  날짜 파싱 실패: {s}")
        return None


def parse_korean_date(s):
    """datetime 파싱 후 date만 반환"""
    dt = parse_korean_datetime(s)
    return dt.date() if dt else None


def parse_sprint_dates(name):
    """'03/09 - 03/20' -> (date, date) 또는 (None, None)"""
    m = re.match(r"(\d{2})/(\d{2})\s*-\s*(\d{2})/(\d{2})", name.strip())
    if not m:
        return None, None
    try:
        year = 2026  # CSV 데이터 기준
        start = date(year, int(m.group(1)), int(m.group(2)))
        end = date(year, int(m.group(3)), int(m.group(4)))
        return start, end
    except Exception:
        return None, None


def parse_start_date_field(s):
    """커스텀 Start date 필드 파싱 (ISO 또는 한국어)"""
    s = s.strip()
    if not s:
        return None
    # ISO 형식: 2026-03-09
    if re.match(r"\d{4}-\d{2}-\d{2}", s):
        try:
            return date.fromisoformat(s[:10])
        except Exception:
            pass
    # 한국어 datetime에서 date만
    return parse_korean_date(s)


# ---------------------------------------------------------------------------
# 마이그레이터
# ---------------------------------------------------------------------------
class CsvMigrator:
    def __init__(self, csv_path, branch_key, fallback_user_id, dry_run, db_url):
        self.csv_path = csv_path
        self.branch_key = branch_key
        self.fallback_user_id = fallback_user_id
        self.dry_run = dry_run
        self.engine = create_engine(db_url)

        self.branch_id = None
        self.rows = []           # 파싱된 CSV 행
        self.epic_rows = []      # 에픽 유형 행
        self.task_rows = []      # 일반 태스크 행
        self.subtask_rows = []   # 하위 작업 행

        # ID 매핑
        self.epic_keys = set()   # 에픽 이슈 키 집합
        self.epic_map = {}       # jira_key -> weave_epic_id
        self.task_map = {}       # jira_key -> weave_task_id
        self.sprint_map = {}     # sprint_name -> weave_sprint_id
        self.label_map = {}      # label_name -> weave_label_id

        self.stats = {
            "task_types": 0, "labels": 0, "sprints": 0,
            "epics": 0, "tasks": 0, "tasks_failed": 0,
        }

    def run(self):
        log.info("=" * 60)
        log.info("Jira CSV -> Weave 마이그레이션 시작")
        if self.dry_run:
            log.info("(DRY RUN - 실제 데이터 저장 안 함)")
        log.info("=" * 60)

        self._load_csv()

        with self.engine.connect() as conn:
            try:
                self._phase0_validate(conn)
                self._phase1_task_types(conn)
                self._phase2_labels(conn)
                self._phase3_sprints(conn)
                self._phase4_epics(conn)
                self._phase5_tasks_pass1(conn)
                self._phase6_tasks_pass2(conn)
                self._phase7_update_sequence(conn)

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
    # CSV 로드 및 분류
    # -----------------------------------------------------------------------
    def _load_csv(self):
        log.info(f"\nCSV 로드: {self.csv_path}")
        with open(self.csv_path, "r", encoding="utf-8") as f:
            reader = csv.reader(f)
            next(reader)  # 헤더 스킵
            self.rows = list(reader)

        for row in self.rows:
            issue_type = row[COL_ISSUE_TYPE].strip()
            if issue_type == "에픽":
                self.epic_rows.append(row)
                self.epic_keys.add(row[COL_ISSUE_KEY].strip())
            elif issue_type == "하위 작업":
                self.subtask_rows.append(row)
            else:
                self.task_rows.append(row)

        log.info(f"  전체: {len(self.rows)}행")
        log.info(f"  에픽: {len(self.epic_rows)}개")
        log.info(f"  일반 태스크: {len(self.task_rows)}개")
        log.info(f"  하위 작업: {len(self.subtask_rows)}개")

    # -----------------------------------------------------------------------
    # Phase 0: Branch 검증
    # -----------------------------------------------------------------------
    def _phase0_validate(self, conn):
        log.info(f"\n[Phase 0] Branch '{self.branch_key}' 검증...")
        result = conn.execute(
            text("SELECT branch_id FROM branch WHERE key = :key"),
            {"key": self.branch_key}
        ).fetchone()
        if not result:
            raise RuntimeError(f"Branch '{self.branch_key}'가 존재하지 않습니다. 먼저 생성해주세요.")
        self.branch_id = result.branch_id
        log.info(f"  Branch ID: {self.branch_id}")

    # -----------------------------------------------------------------------
    # Phase 1: Task Type 설정
    # -----------------------------------------------------------------------
    def _phase1_task_types(self, conn):
        log.info("\n[Phase 1] Task Type 설정...")

        # 기존 타입 조회
        existing = conn.execute(
            text("SELECT type_key FROM task_type_config WHERE branch_id = :bid"),
            {"bid": self.branch_id}
        ).fetchall()
        existing_keys = {r.type_key for r in existing}

        # CSV에서 사용된 유형 수집
        used_types = set()
        for row in self.task_rows + self.subtask_rows:
            t = row[COL_ISSUE_TYPE].strip().lower()
            if t != "하위 작업":
                used_types.add(t)

        count = 0
        sort_order = len(existing_keys)
        for type_key in sorted(used_types):
            if type_key in existing_keys:
                continue
            if type_key not in TASK_TYPE_DEFS:
                log.warning(f"  알 수 없는 이슈 유형: {type_key} -> 'task'로 매핑")
                continue

            name, icon, color = TASK_TYPE_DEFS[type_key]
            conn.execute(text("""
                INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
                VALUES (:bid, :key, :name, :icon, :color, :sort)
            """), {
                "bid": self.branch_id,
                "key": type_key,
                "name": name,
                "icon": icon,
                "color": color,
                "sort": sort_order,
            })
            sort_order += 1
            count += 1
            log.info(f"  + {type_key} ({name})")

        self.stats["task_types"] = count
        log.info(f"  Task Type {count}개 추가")

    # -----------------------------------------------------------------------
    # Phase 2: Label 생성
    # -----------------------------------------------------------------------
    def _phase2_labels(self, conn):
        log.info("\n[Phase 2] Label 생성...")

        # CSV에서 라벨 수집
        label_names = set()
        for row in self.rows:
            label = row[COL_LABEL].strip()
            if label:
                label_names.add(label)

        if not label_names:
            log.info("  라벨 없음")
            return

        # 기존 라벨 조회
        existing = conn.execute(
            text("SELECT label_id, label_name FROM label WHERE branch_id = :bid"),
            {"bid": self.branch_id}
        ).fetchall()
        existing_map = {r.label_name: r.label_id for r in existing}

        count = 0
        for i, name in enumerate(sorted(label_names)):
            if name in existing_map:
                self.label_map[name] = existing_map[name]
                continue
            result = conn.execute(text("""
                INSERT INTO label (branch_id, label_name, color)
                VALUES (:bid, :name, :color)
                RETURNING label_id
            """), {
                "bid": self.branch_id,
                "name": name,
                "color": LABEL_COLORS[i % len(LABEL_COLORS)],
            })
            self.label_map[name] = result.scalar_one()
            count += 1
            log.info(f"  + {name}")

        self.stats["labels"] = count
        log.info(f"  Label {count}개 생성")

    # -----------------------------------------------------------------------
    # Phase 3: Sprint 생성
    # -----------------------------------------------------------------------
    def _phase3_sprints(self, conn):
        log.info("\n[Phase 3] Sprint 생성...")

        # CSV에서 고유 스프린트명 수집
        sprint_names = set()
        for row in self.rows:
            for i in range(COL_SPRINT_START, COL_SPRINT_END + 1):
                if i < len(row) and row[i].strip():
                    sprint_names.add(row[i].strip())

        if not sprint_names:
            log.info("  스프린트 없음")
            return

        # 기존 스프린트 조회
        existing = conn.execute(
            text("SELECT sprint_id, sprint_name FROM sprint WHERE branch_id = :bid"),
            {"bid": self.branch_id}
        ).fetchall()
        existing_map = {r.sprint_name: r.sprint_id for r in existing}

        count = 0
        for name in sorted(sprint_names):
            if name in existing_map:
                self.sprint_map[name] = existing_map[name]
                continue

            start_d, end_d = parse_sprint_dates(name)
            result = conn.execute(text("""
                INSERT INTO sprint (branch_id, sprint_name, start_date, end_date,
                                    status, sort_order, created_by)
                VALUES (:bid, :name, :start, :end, :status, :sort, :uid)
                RETURNING sprint_id
            """), {
                "bid": self.branch_id,
                "name": name,
                "start": start_d,
                "end": end_d,
                "status": ("active" if end_d and end_d >= date.today() and start_d <= date.today()
                           else "closed") if start_d else "future",
                "sort": count,
                "uid": self.fallback_user_id,
            })
            self.sprint_map[name] = result.scalar_one()
            count += 1
            log.info(f"  + {name}")

        self.stats["sprints"] = count
        log.info(f"  Sprint {count}개 생성")

    # -----------------------------------------------------------------------
    # Phase 4: Epic 생성
    # -----------------------------------------------------------------------
    def _phase4_epics(self, conn):
        log.info("\n[Phase 4] Epic 생성...")

        # 기존 에픽 조회 (이름 기준)
        existing = conn.execute(
            text("SELECT epic_id, epic_name FROM epic WHERE branch_id = :bid"),
            {"bid": self.branch_id}
        ).fetchall()
        existing_map = {r.epic_name: r.epic_id for r in existing}

        count = 0
        for row in self.epic_rows:
            title = row[COL_TITLE].strip()
            jira_key = row[COL_ISSUE_KEY].strip()
            status = STATUS_MAP.get(row[COL_STATUS].strip(), "todo")
            due_date = parse_korean_date(row[COL_DUE_DATE])
            start_date = parse_start_date_field(row[COL_START_DATE]) if COL_START_DATE < len(row) else None

            if title in existing_map:
                self.epic_map[jira_key] = existing_map[title]
                continue

            result = conn.execute(text("""
                INSERT INTO epic (branch_id, epic_name, description, status, color,
                                  start_date, due_date, sort_order, created_by)
                VALUES (:bid, :name, :desc, :status, :color,
                        :start, :due, :sort, :uid)
                RETURNING epic_id
            """), {
                "bid": self.branch_id,
                "name": title,
                "desc": row[COL_DESCRIPTION].strip() if COL_DESCRIPTION < len(row) else "",
                "status": status,
                "color": EPIC_COLORS[count % len(EPIC_COLORS)],
                "start": start_date,
                "due": due_date,
                "sort": count,
                "uid": self.fallback_user_id,
            })
            self.epic_map[jira_key] = result.scalar_one()
            count += 1
            log.info(f"  + {jira_key}: {title}")

        self.stats["epics"] = count
        log.info(f"  Epic {count}개 생성")

    # -----------------------------------------------------------------------
    # Phase 5: Task Pass 1 (일반 이슈)
    # -----------------------------------------------------------------------
    def _phase5_tasks_pass1(self, conn):
        log.info(f"\n[Phase 5] Task Pass 1: 일반 이슈 {len(self.task_rows)}개...")
        for row in self.task_rows:
            self._insert_task(conn, row)
        log.info(f"  Pass 1 완료: {self.stats['tasks']}개 성공, {self.stats['tasks_failed']}개 실패")

    # -----------------------------------------------------------------------
    # Phase 6: Task Pass 2 (하위 작업)
    # -----------------------------------------------------------------------
    def _phase6_tasks_pass2(self, conn):
        log.info(f"\n[Phase 6] Task Pass 2: 하위 작업 {len(self.subtask_rows)}개...")
        before = self.stats["tasks"]
        for row in self.subtask_rows:
            self._insert_task(conn, row)
        after = self.stats["tasks"] - before
        log.info(f"  Pass 2 완료: {after}개 성공")

    # -----------------------------------------------------------------------
    # Task 삽입 공통
    # -----------------------------------------------------------------------
    def _insert_task(self, conn, row):
        try:
            jira_key = row[COL_ISSUE_KEY].strip()
            title = row[COL_TITLE].strip()
            issue_type = row[COL_ISSUE_TYPE].strip().lower()

            # display_number 추출 (AL-412 -> 412)
            dn_match = re.search(r"-(\d+)$", jira_key)
            if not dn_match:
                log.warning(f"  이슈 키에서 번호 추출 실패: {jira_key}")
                self.stats["tasks_failed"] += 1
                return
            display_number = int(dn_match.group(1))

            # 이미 존재하는지 확인 (멱등성)
            existing = conn.execute(
                text("SELECT task_id FROM task WHERE branch_id = :bid AND display_number = :dn"),
                {"bid": self.branch_id, "dn": display_number}
            ).fetchone()
            if existing:
                self.task_map[jira_key] = existing.task_id
                return

            # task_type 결정
            if issue_type == "하위 작업":
                task_type = "task"
            else:
                task_type = issue_type if issue_type in TASK_TYPE_DEFS else "task"

            # status, priority
            status = STATUS_MAP.get(row[COL_STATUS].strip(), "todo")
            priority = PRIORITY_MAP.get(row[COL_PRIORITY].strip().lower(), "medium")

            # epic_id / parent_task_id
            epic_id = None
            parent_task_id = None
            parent_key = row[COL_PARENT_KEY].strip() if COL_PARENT_KEY < len(row) else ""
            if parent_key:
                if parent_key in self.epic_keys:
                    epic_id = self.epic_map.get(parent_key)
                else:
                    parent_task_id = self.task_map.get(parent_key)

            # sprint_id (마지막 비어있지 않은 스프린트 사용)
            sprint_id = None
            for i in range(COL_SPRINT_END, COL_SPRINT_START - 1, -1):
                if i < len(row) and row[i].strip():
                    sprint_id = self.sprint_map.get(row[i].strip())
                    if sprint_id:
                        break

            # 날짜
            start_date = parse_start_date_field(row[COL_START_DATE]) if COL_START_DATE < len(row) else None
            due_date = parse_korean_date(row[COL_DUE_DATE])
            created_at = parse_korean_datetime(row[COL_CREATED])
            updated_at = parse_korean_datetime(row[COL_UPDATED])

            # 설명
            description = row[COL_DESCRIPTION].strip() if COL_DESCRIPTION < len(row) else ""

            # INSERT
            result = conn.execute(text("""
                INSERT INTO task (branch_id, display_number, title, description,
                                  task_type, status, priority, epic_id, sprint_id,
                                  parent_task_id, start_date, due_date,
                                  created_by, created_at, updated_at)
                VALUES (:bid, :dn, :title, :desc, :type, :status, :priority,
                        :eid, :sid, :pid, :start, :due,
                        :uid, COALESCE(:created, NOW()), :updated)
                RETURNING task_id
            """), {
                "bid": self.branch_id,
                "dn": display_number,
                "title": title,
                "desc": description or None,
                "type": task_type,
                "status": status,
                "priority": priority,
                "eid": epic_id,
                "sid": sprint_id,
                "pid": parent_task_id,
                "start": start_date,
                "due": due_date,
                "uid": self.fallback_user_id,
                "created": created_at,
                "updated": updated_at,
            })
            task_id = result.scalar_one()
            self.task_map[jira_key] = task_id

            # 담당자 (main)
            assignee = row[COL_ASSIGNEE].strip() if COL_ASSIGNEE < len(row) else ""
            if assignee:
                conn.execute(text("""
                    INSERT INTO task_assignee (task_id, user_id, role)
                    VALUES (:tid, :uid, 'main')
                """), {"tid": task_id, "uid": self.fallback_user_id})

            # 라벨
            label_name = row[COL_LABEL].strip() if COL_LABEL < len(row) else ""
            if label_name and label_name in self.label_map:
                conn.execute(text("""
                    INSERT INTO task_label (task_id, label_id)
                    VALUES (:tid, :lid)
                """), {"tid": task_id, "lid": self.label_map[label_name]})

            self.stats["tasks"] += 1

        except Exception:
            self.stats["tasks_failed"] += 1
            log.exception(f"  Task 삽입 실패: {row[COL_ISSUE_KEY] if len(row) > COL_ISSUE_KEY else '?'}")

    # -----------------------------------------------------------------------
    # Phase 7: task_sequence 업데이트
    # -----------------------------------------------------------------------
    def _phase7_update_sequence(self, conn):
        log.info("\n[Phase 7] task_sequence 업데이트...")

        # 현재 최대 display_number 조회
        result = conn.execute(
            text("SELECT COALESCE(MAX(display_number), 0) as max_dn FROM task WHERE branch_id = :bid"),
            {"bid": self.branch_id}
        ).fetchone()
        max_dn = result.max_dn

        # task_sequence 존재 확인
        existing = conn.execute(
            text("SELECT last_number FROM task_sequence WHERE branch_id = :bid"),
            {"bid": self.branch_id}
        ).fetchone()

        if existing:
            if max_dn > existing.last_number:
                conn.execute(
                    text("UPDATE task_sequence SET last_number = :dn WHERE branch_id = :bid"),
                    {"bid": self.branch_id, "dn": max_dn}
                )
                log.info(f"  task_sequence 업데이트: {existing.last_number} -> {max_dn}")
            else:
                log.info(f"  task_sequence 이미 최신: {existing.last_number}")
        else:
            conn.execute(
                text("INSERT INTO task_sequence (branch_id, last_number) VALUES (:bid, :dn)"),
                {"bid": self.branch_id, "dn": max_dn}
            )
            log.info(f"  task_sequence 생성: {max_dn}")

    # -----------------------------------------------------------------------
    # 결과 요약
    # -----------------------------------------------------------------------
    def _print_summary(self):
        log.info("\n" + "=" * 60)
        log.info("마이그레이션 결과 요약")
        log.info("=" * 60)
        log.info(f"  Task Types: {self.stats['task_types']}개 추가")
        log.info(f"  Labels:     {self.stats['labels']}개 생성")
        log.info(f"  Sprints:    {self.stats['sprints']}개 생성")
        log.info(f"  Epics:      {self.stats['epics']}개 생성")
        log.info(f"  Tasks:      {self.stats['tasks']}개 생성 ({self.stats['tasks_failed']}개 실패)")
        log.info("=" * 60)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Jira CSV -> Weave 마이그레이션")
    parser.add_argument("--csv-path", required=True,
                        help="Jira CSV 파일 경로")
    parser.add_argument("--branch-key", required=True,
                        help="Weave Branch 키 (예: AL)")
    parser.add_argument("--fallback-user-id", type=int, default=1,
                        help="모든 유저에 할당할 user_id (기본: 1)")
    parser.add_argument("--dry-run", action="store_true",
                        help="실제 저장 없이 테스트 실행")
    parser.add_argument("--db-url", default=None,
                        help="DB URL 직접 지정 (미지정 시 config.py 사용)")
    args = parser.parse_args()

    db_url = args.db_url or DATABASE_URL_SYNC
    log.info(f"DB: {db_url.split('@')[-1] if '@' in db_url else '(local)'}")

    migrator = CsvMigrator(
        csv_path=args.csv_path,
        branch_key=args.branch_key,
        fallback_user_id=args.fallback_user_id,
        dry_run=args.dry_run,
        db_url=db_url,
    )
    migrator.run()


if __name__ == "__main__":
    main()
