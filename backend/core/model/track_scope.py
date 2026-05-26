from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def add(track_id: int, branch_id: int, scope_type: str, scope_id: int,
              db: AsyncSession):
    """Sprint/Epic scope marker 추가 (idempotent)."""
    await db.execute(text("""
        INSERT INTO track_scope (track_id, branch_id, scope_type, scope_id)
        VALUES (:track_id, :branch_id, :scope_type, :scope_id)
        ON CONFLICT (track_id, branch_id, scope_type, scope_id) DO NOTHING
    """), {
        'track_id': track_id, 'branch_id': branch_id,
        'scope_type': scope_type, 'scope_id': scope_id,
    })


async def add_sprints_for_tasks(track_id: int, task_ids: list, db: AsyncSession):
    """task들의 distinct (branch_id, sprint_id) 조합을 sprint scope로 자동 등록.
    sprint_id IS NULL인 task는 skip (백로그는 scope 없음)."""
    if not task_ids:
        return
    await db.execute(text("""
        INSERT INTO track_scope (track_id, branch_id, scope_type, scope_id)
        SELECT DISTINCT :track_id, t.branch_id, 'sprint', t.sprint_id
        FROM task t
        WHERE t.task_id = ANY(:task_ids) AND t.sprint_id IS NOT NULL
        ON CONFLICT (track_id, branch_id, scope_type, scope_id) DO NOTHING
    """), {'track_id': track_id, 'task_ids': task_ids})


async def resolve_scope_branch(scope_type: str, scope_id: int,
                                db: AsyncSession):
    """sprint/epic id의 canonical branch_id를 조회. 존재하지 않으면 None."""
    table = 'sprint' if scope_type == 'sprint' else 'epic'
    result = await db.execute(text(f"""
        SELECT branch_id FROM {table} WHERE {table}_id = :id
    """), {'id': scope_id})
    row = result.fetchone()
    return row[0] if row else None


async def delete_by_branch(track_id: int, branch_id: int, db: AsyncSession):
    """Branch unparticipate cascade — 그 branch의 모든 scope 제거."""
    await db.execute(text("""
        DELETE FROM track_scope
        WHERE track_id = :track_id AND branch_id = :branch_id
    """), {'track_id': track_id, 'branch_id': branch_id})


# 모든 scope task 쿼리에 공통으로 들어가는 SELECT 절 — sprint/epic 두 쿼리가 ~95% 동일하므로 한 곳에서 관리
# Done 처리 규칙: task가 속한 sprint가 active이면 done까지 노출(회고/이월 판단용).
# 그 외(닫힌 sprint, sprint 없는 backlog/epic task)는 done/cancelled 제외.
_SCOPE_TASK_QUERY = """
    SELECT t.task_id, t.title, t.display_number, t.status, t.priority,
           t.sprint_id, t.epic_id, t.branch_id,
           b.key AS branch_key,
           ws.label AS status_label, ws.color AS status_color,
           ws.category AS status_category,
           EXISTS (
               SELECT 1 FROM track_item ti
               WHERE ti.track_id = :track_id
                 AND ti.source_type = 'task'
                 AND ti.source_task_id = t.task_id
           ) AS in_track
    FROM task t
    INNER JOIN branch b ON t.branch_id = b.branch_id
    LEFT JOIN sprint sp ON sp.sprint_id = t.sprint_id
    LEFT JOIN workflow_status ws
        ON ws.branch_id = t.branch_id AND ws.key = t.status
    WHERE t.{filter_col} = ANY(:ids)
      AND t.parent_task_id IS NULL
      AND (COALESCE(sp.status, '') = 'active'
           OR ws.category IS NULL
           OR ws.category NOT IN ('done', 'cancelled'))
    ORDER BY t.task_id
"""


async def _fetch_scope_tasks(track_id: int, filter_col: str, ids: list,
                              db: AsyncSession):
    """filter_col ('sprint_id' or 'epic_id') 기준으로 task 묶음 조회.
    반환: {scope_id: [task, ...]}."""
    if not ids:
        return {}
    rows = await db.execute(
        text(_SCOPE_TASK_QUERY.format(filter_col=filter_col)),
        {'track_id': track_id, 'ids': ids},
    )
    bucket = {}
    for r in rows.fetchall():
        d = dict(r._mapping)
        d['display_id'] = f"{d['branch_key']}-{d['display_number']}"
        key = d[filter_col]
        bucket.setdefault(key, []).append(d)
    return bucket


async def find_tree(track_id: int, user_id: int, db: AsyncSession):
    """Sidebar tree — branch → sprint/epic groups → tasks.
    각 group은 그 sprint/epic의 모든 task를 사용자 권한 안에서 노출.
    """
    # 1. Track에 참여한 branch 목록 (사용자가 멤버인 것만)
    branches_result = await db.execute(text("""
        SELECT tb.branch_id, b.branch_name, b.key AS branch_key,
               COALESCE(tb.color_override, b.color) AS branch_color
        FROM track_branch tb
        INNER JOIN branch b ON tb.branch_id = b.branch_id
        INNER JOIN branch_member bm
            ON bm.branch_id = tb.branch_id AND bm.user_id = :user_id
        WHERE tb.track_id = :track_id AND b.is_archived = FALSE
        ORDER BY b.branch_name
    """), {'track_id': track_id, 'user_id': user_id})
    branches = [dict(r._mapping) for r in branches_result.fetchall()]
    if not branches:
        return []

    # 2. 모든 scope rows
    scopes_result = await db.execute(text("""
        SELECT branch_id, scope_type, scope_id
        FROM track_scope
        WHERE track_id = :track_id
    """), {'track_id': track_id})
    scopes = [dict(r._mapping) for r in scopes_result.fetchall()]

    sprint_ids = [s['scope_id'] for s in scopes if s['scope_type'] == 'sprint']
    epic_ids = [s['scope_id'] for s in scopes if s['scope_type'] == 'epic']

    # 3. Sprint/Epic 메타데이터
    sprint_meta = {}
    if sprint_ids:
        meta = await db.execute(text("""
            SELECT sprint_id, sprint_name, status
            FROM sprint WHERE sprint_id = ANY(:ids)
        """), {'ids': sprint_ids})
        sprint_meta = {r._mapping['sprint_id']: dict(r._mapping)
                       for r in meta.fetchall()}

    epic_meta = {}
    if epic_ids:
        meta = await db.execute(text("""
            SELECT epic_id, epic_name, color
            FROM epic WHERE epic_id = ANY(:ids)
        """), {'ids': epic_ids})
        epic_meta = {r._mapping['epic_id']: dict(r._mapping)
                     for r in meta.fetchall()}

    # 4. 각 scope의 task 묶음
    sprint_tasks_by_id = await _fetch_scope_tasks(
        track_id, 'sprint_id', sprint_ids, db)
    epic_tasks_by_id = await _fetch_scope_tasks(
        track_id, 'epic_id', epic_ids, db)

    # 5. 트리 조립
    tree = []
    for b in branches:
        bid = b['branch_id']
        b_sprints = []
        b_epics = []
        for s in scopes:
            if s['branch_id'] != bid:
                continue
            if s['scope_type'] == 'sprint':
                meta = sprint_meta.get(s['scope_id'])
                if not meta:
                    continue  # sprint 삭제됨 — silent skip
                b_sprints.append({
                    'sprint_id': s['scope_id'],
                    'sprint_name': meta['sprint_name'],
                    'status': meta['status'],
                    'tasks': sprint_tasks_by_id.get(s['scope_id'], []),
                })
            elif s['scope_type'] == 'epic':
                meta = epic_meta.get(s['scope_id'])
                if not meta:
                    continue
                b_epics.append({
                    'epic_id': s['scope_id'],
                    'epic_name': meta['epic_name'],
                    'color': meta['color'],
                    'tasks': epic_tasks_by_id.get(s['scope_id'], []),
                })
        # active sprint 먼저
        b_sprints.sort(key=lambda x: (x['status'] != 'active', x['sprint_name']))
        b_epics.sort(key=lambda x: x['epic_name'])
        tree.append({
            'branch_id': bid,
            'branch_name': b['branch_name'],
            'branch_key': b['branch_key'],
            'branch_color': b['branch_color'],
            'sprints': b_sprints,
            'epics': b_epics,
        })
    return tree
