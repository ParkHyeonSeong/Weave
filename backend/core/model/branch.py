from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# 멤버 아바타 색상 — 프론트 library/userAvatar.js 의 AVATAR_COLORS 와 동일하게 유지.
# user_id 를 안정적으로 같은 색에 매핑(흰 텍스트와 WCAG AA 대비 확보된 톤).
_AVATAR_COLORS = [
    '#5E6AD2', '#059669', '#B45309', '#9333EA',
    '#BE185D', '#0369A1', '#DC2626',
]


def _user_color(user_id) -> str:
    if user_id is None:
        return '#9CA3AF'
    return _AVATAR_COLORS[abs(int(user_id)) % len(_AVATAR_COLORS)]


async def create(branch_name: str, key: str, description: str,
                 visibility: str, created_by: int, db: AsyncSession) -> int:
    """Branch 생성"""
    result = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, created_by)
        VALUES (:branch_name, :key, :description, :visibility, :created_by)
        RETURNING branch_id
    """), {
        'branch_name': branch_name,
        'key': key,
        'description': description,
        'visibility': visibility,
        'created_by': created_by,
    })
    return result.scalar_one()


async def find_by_id(branch_id: int, db: AsyncSession):
    """Branch 상세 조회"""
    result = await db.execute(text("""
        SELECT b.branch_id, b.branch_name, b.key, b.description,
               b.icon, b.color, b.visibility, b.is_archived,
               b.created_by, b.created_at, b.updated_at
        FROM branch b
        WHERE b.branch_id = :branch_id AND b.is_archived = FALSE
    """), {'branch_id': branch_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_accessible(user_id: int, db: AsyncSession):
    """사용자가 접근 가능한 Branch 목록 (홈 카드 집계 필드 포함).

    각 branch dict 에 추가되는 필드:
    - task_total / task_done / progress_percent (done = workflow_status category in done/cancelled)
    - active_sprint_name (가장 최근 active sprint 이름, 없으면 None)
    - member_count, members (상위 4명 [{name, color}])

    집계는 단일 목록 쿼리에서 상관 서브쿼리로 처리하고, 멤버 미리보기만 별도
    배치 쿼리 1회로 가져와 N+1 을 피한다.
    """
    result = await db.execute(text("""
        SELECT b.branch_id, b.branch_name, b.key, b.description,
               b.icon, b.color, b.visibility, b.created_at,
               bm.role AS my_role,
               COALESCE(ta.task_total, 0) AS task_total,
               COALESCE(ta.task_done, 0) AS task_done,
               (SELECT s.sprint_name FROM sprint s
                WHERE s.branch_id = b.branch_id AND s.status = 'active'
                ORDER BY s.created_at DESC, s.sprint_id DESC
                LIMIT 1) AS active_sprint_name,
               (SELECT COUNT(*) FROM branch_member bm2
                WHERE bm2.branch_id = b.branch_id) AS member_count
        FROM branch b
        INNER JOIN branch_member bm ON b.branch_id = bm.branch_id
        LEFT JOIN (
            -- Caveat: tasks whose status has no matching workflow_status row fall back
            -- to 'done' (mirrors core/model/task.py). Such orphan-status tasks are thus
            -- counted as complete. Assumes every task.status maps to a workflow_status.
            SELECT t.branch_id,
                   COUNT(*) AS task_total,
                   COUNT(*) FILTER (
                       WHERE COALESCE(ws.category, 'done') IN ('done', 'cancelled')
                   ) AS task_done
            FROM task t
            LEFT JOIN workflow_status ws
                ON ws.branch_id = t.branch_id AND ws.key = t.status
            GROUP BY t.branch_id
        ) ta ON ta.branch_id = b.branch_id
        WHERE bm.user_id = :user_id AND b.is_archived = FALSE
        ORDER BY b.branch_name
    """), {'user_id': user_id})
    branches = [dict(row._mapping) for row in result.fetchall()]

    if not branches:
        return branches

    for b in branches:
        total = b['task_total']
        b['progress_percent'] = round(b['task_done'] / total * 100) if total else 0
        b['members'] = []

    # 멤버 미리보기(상위 4명) 배치 조회 — branch 당 가입 순으로 4명까지.
    branch_ids = [b['branch_id'] for b in branches]
    members_result = await db.execute(text("""
        SELECT branch_id, user_id, username
        FROM (
            SELECT bm.branch_id, bm.user_id, u.username,
                   ROW_NUMBER() OVER (
                       PARTITION BY bm.branch_id
                       ORDER BY bm.joined_at, bm.user_id
                   ) AS rn
            FROM branch_member bm
            INNER JOIN "user" u ON bm.user_id = u.user_id
            WHERE bm.branch_id = ANY(:branch_ids)
        ) ranked
        WHERE rn <= 4
        ORDER BY branch_id, rn
    """), {'branch_ids': branch_ids})

    by_branch = {b['branch_id']: b for b in branches}
    for row in members_result.fetchall():
        m = row._mapping
        by_branch[m['branch_id']]['members'].append({
            'name': m['username'],
            'color': _user_color(m['user_id']),
        })

    return branches


async def home_stats(user_id: int, db: AsyncSession):
    """사용자가 접근 가능한 Branch 전체에 대한 홈 KPI 집계.

    - open_count: 미완료(done/cancelled 외) 중 in_progress 가 아닌 태스크 수
    - in_progress_count: category = 'in_progress' 태스크 수
    - due_this_week_count: due_date 가 오늘~+7일 이내인 미완료 태스크 수
    - active_sprint_count: status = 'active' 스프린트 수
    모두 사용자가 멤버인(아카이브 안 된) branch 기준.
    """
    result = await db.execute(text("""
        WITH my_branches AS (
            SELECT b.branch_id
            FROM branch b
            INNER JOIN branch_member bm ON b.branch_id = bm.branch_id
            WHERE bm.user_id = :user_id AND b.is_archived = FALSE
        ),
        my_tasks AS (
            SELECT t.task_id, t.due_date,
                   COALESCE(ws.category, 'done') AS category
            FROM task t
            INNER JOIN my_branches mb ON mb.branch_id = t.branch_id
            LEFT JOIN workflow_status ws
                ON ws.branch_id = t.branch_id AND ws.key = t.status
        )
        SELECT
            COUNT(*) FILTER (
                WHERE category NOT IN ('done', 'cancelled', 'in_progress')
            ) AS open_count,
            COUNT(*) FILTER (WHERE category = 'in_progress') AS in_progress_count,
            COUNT(*) FILTER (
                WHERE category NOT IN ('done', 'cancelled')
                  AND due_date IS NOT NULL
                  AND due_date >= CURRENT_DATE
                  AND due_date < CURRENT_DATE + 7
            ) AS due_this_week_count,
            (SELECT COUNT(*) FROM sprint s
             INNER JOIN my_branches mb2 ON mb2.branch_id = s.branch_id
             WHERE s.status = 'active') AS active_sprint_count
        FROM my_tasks
    """), {'user_id': user_id})
    row = result.fetchone()
    return {
        'open_count': row._mapping['open_count'],
        'in_progress_count': row._mapping['in_progress_count'],
        'due_this_week_count': row._mapping['due_this_week_count'],
        'active_sprint_count': row._mapping['active_sprint_count'],
    }


async def update(branch_id: int, fields: dict, db: AsyncSession):
    """Branch 정보 수정"""
    set_clauses = ', '.join(f'{k} = :{k}' for k in fields)
    params = {**fields, 'branch_id': branch_id}
    await db.execute(text(f"""
        UPDATE branch SET {set_clauses}, updated_at = NOW()
        WHERE branch_id = :branch_id
    """), params)


async def find_by_key(key: str, db: AsyncSession):
    """key로 Branch 조회 (중복 체크용)"""
    result = await db.execute(text("""
        SELECT branch_id FROM branch WHERE key = :key
    """), {'key': key})
    return result.fetchone() is not None


async def archive(branch_id: int, db: AsyncSession):
    """Branch 아카이브 (soft delete)"""
    await db.execute(text("""
        UPDATE branch SET is_archived = TRUE, updated_at = NOW()
        WHERE branch_id = :branch_id
    """), {'branch_id': branch_id})


async def restore(branch_id: int, db: AsyncSession):
    """Branch 복원 (is_archived=FALSE)"""
    await db.execute(text("""
        UPDATE branch SET is_archived = FALSE, updated_at = NOW()
        WHERE branch_id = :branch_id
    """), {'branch_id': branch_id})


async def find_archived(user_id: int, db: AsyncSession):
    """admin인 사용자의 아카이브된 Branch 목록(보관함용)."""
    result = await db.execute(text("""
        SELECT b.branch_id, b.branch_name, b.key, b.icon, b.color,
               b.updated_at, bm.role AS my_role
        FROM branch b
        INNER JOIN branch_member bm ON b.branch_id = bm.branch_id
        WHERE bm.user_id = :user_id AND b.is_archived = TRUE AND bm.role = 'admin'
        ORDER BY b.updated_at DESC NULLS LAST, b.branch_id DESC
    """), {'user_id': user_id})
    return [dict(r._mapping) for r in result.fetchall()]


async def hard_delete(branch_id: int, db: AsyncSession):
    """Branch 영구 삭제. canvas는 detach(branch_id=NULL), poly 참조 정리 후 branch 삭제.
    branch 자식(task/sprint/epic/...)은 ON DELETE CASCADE로 자동 삭제된다.
    canvas.branch_id는 NO ACTION이라 먼저 끊어야 FK 위반이 안 난다(문서는 보존).
    """
    # 1) 이 브랜치 task를 가리키는 poly 참조(FK 없음) 정리
    await db.execute(text("""
        DELETE FROM recent_view
        WHERE item_type = 'task' AND item_id IN (
            SELECT task_id FROM task WHERE branch_id = :branch_id)
    """), {'branch_id': branch_id})
    await db.execute(text("""
        DELETE FROM user_star
        WHERE item_type = 'task' AND item_id IN (
            SELECT task_id FROM task WHERE branch_id = :branch_id)
    """), {'branch_id': branch_id})
    await db.execute(text("""
        DELETE FROM notification
        WHERE (entity_type = 'task' AND entity_id IN (
                 SELECT task_id FROM task WHERE branch_id = :branch_id))
           OR (entity_type = 'branch' AND entity_id = :branch_id)
    """), {'branch_id': branch_id})
    # 2) canvas detach (branch_id NULL → 문서 보존)
    await db.execute(text("""
        UPDATE canvas SET branch_id = NULL WHERE branch_id = :branch_id
    """), {'branch_id': branch_id})
    # 3) branch 삭제 → 나머지 자식 CASCADE
    await db.execute(text("""
        DELETE FROM branch WHERE branch_id = :branch_id
    """), {'branch_id': branch_id})


async def find_public(user_id: int, query: str, db: AsyncSession):
    """public Branch 목록 (가입 여부 포함)"""
    params = {'user_id': user_id}
    where_search = ''
    if query:
        where_search = "AND (b.branch_name ILIKE :q OR b.key ILIKE :q)"
        params['q'] = f'%{query}%'

    result = await db.execute(text(f"""
        SELECT b.branch_id, b.branch_name, b.key, b.description,
               b.color, b.created_at,
               (SELECT COUNT(*) FROM branch_member bm2
                WHERE bm2.branch_id = b.branch_id) AS member_count,
               EXISTS(
                   SELECT 1 FROM branch_member bm3
                   WHERE bm3.branch_id = b.branch_id AND bm3.user_id = :user_id
               ) AS is_member
        FROM branch b
        WHERE b.visibility = 'public'
          AND b.is_archived = FALSE
          {where_search}
        ORDER BY b.branch_name
    """), params)
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]
