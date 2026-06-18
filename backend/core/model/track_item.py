from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create_task_ref(track_id: int, task_id: int,
                           position_x: float, position_y: float,
                           db: AsyncSession) -> int:
    """task 참조 item 생성 (drag&drop용). 중복 시 사용자 의도 = 새 위치로 이동이라 위치 갱신."""
    result = await db.execute(text("""
        INSERT INTO track_item (track_id, source_type, source_task_id, position_x, position_y)
        VALUES (:track_id, 'task', :task_id, :px, :py)
        ON CONFLICT (track_id, source_task_id) WHERE source_type = 'task' AND source_task_id IS NOT NULL
        DO UPDATE SET position_x = EXCLUDED.position_x, position_y = EXCLUDED.position_y
        RETURNING item_id
    """), {
        'track_id': track_id,
        'task_id': task_id,
        'px': position_x,
        'py': position_y,
    })
    return result.scalar_one()


async def create_task_ref_idempotent(track_id: int, task_id: int,
                                       db: AsyncSession):
    """Bulk add용 — 이미 있으면 기존 item 그대로 (위치 보존), 없으면 (0,0)으로 추가.
    리턴: (item_id, created) — created=False면 이미 존재했음."""
    result = await db.execute(text("""
        INSERT INTO track_item (track_id, source_type, source_task_id, position_x, position_y)
        VALUES (:track_id, 'task', :task_id, 0, 0)
        ON CONFLICT (track_id, source_task_id) WHERE source_type = 'task' AND source_task_id IS NOT NULL
        DO NOTHING
        RETURNING item_id
    """), {'track_id': track_id, 'task_id': task_id})
    row = result.fetchone()
    if row:
        return row[0], True
    existing = await db.execute(text("""
        SELECT item_id FROM track_item
        WHERE track_id = :track_id AND source_type = 'task' AND source_task_id = :task_id
    """), {'track_id': track_id, 'task_id': task_id})
    return existing.scalar_one(), False


async def find_by_id(item_id: int, db: AsyncSession):
    """item 단건 (track_id 포함)"""
    result = await db.execute(text("""
        SELECT item_id, track_id, source_type, source_task_id, source_epic_id,
               note_text, layer_id, virtual_parent_id, position_x, position_y,
               color_override, label_override
        FROM track_item
        WHERE item_id = :item_id
    """), {'item_id': item_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_by_track(track_id: int, user_id: int, db: AsyncSession):
    """Track의 모든 item을 hydrated 형태로 반환.
    사용자가 source task의 branch에 멤버가 아니면 restricted=True 마킹.
    """
    # 한 번에 task 정보 hydrate + 사용자 branch_member 여부도 LEFT JOIN으로 체크
    result = await db.execute(text("""
        SELECT
            ti.item_id, ti.source_type, ti.source_task_id, ti.source_epic_id,
            ti.note_text, ti.layer_id, ti.virtual_parent_id,
            ti.position_x, ti.position_y,
            ti.color_override, ti.label_override,
            t.task_id, t.title, t.description, t.display_number,
            t.status, t.priority, t.start_date, t.due_date,
            b.branch_id, b.branch_name, b.key AS branch_key, b.color AS branch_color, b.icon AS branch_icon,
            ws.label AS status_label, ws.color AS status_color, ws.category AS status_category,
            CASE WHEN bm.user_id IS NULL OR b.is_archived THEN TRUE ELSE FALSE END AS restricted
        FROM track_item ti
        LEFT JOIN task t ON ti.source_task_id = t.task_id
        LEFT JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN workflow_status ws
            ON ws.branch_id = t.branch_id AND ws.key = t.status
        LEFT JOIN branch_member bm
            ON bm.branch_id = t.branch_id AND bm.user_id = :user_id
        WHERE ti.track_id = :track_id
        ORDER BY ti.item_id
    """), {'track_id': track_id, 'user_id': user_id})

    rows = [dict(r._mapping) for r in result.fetchall()]
    items = []
    accessible_task_ids = []

    for r in rows:
        # task가 삭제됐거나 (LEFT JOIN NULL), 접근권 없음
        is_restricted = r.get('restricted') or r.get('task_id') is None

        item = {
            'item_id': r['item_id'],
            'source_type': r['source_type'],
            'position_x': r['position_x'],
            'position_y': r['position_y'],
            'layer_id': r['layer_id'],
            'virtual_parent_id': r['virtual_parent_id'],
        }
        if is_restricted:
            # 의도적 leak: branch 이름까지는 노출(흐름 파악용). title/assignees/dates 등 task 본문은 가림.
            item['restricted'] = True
            item['restricted_hint'] = r.get('branch_name') or None
        else:
            item.update({
                'restricted': False,
                'task_id': r['task_id'],
                'branch_id': r['branch_id'],
                'branch_key': r['branch_key'],
                'branch_color': r['branch_color'],
                'branch_icon': r.get('branch_icon'),
                'branch_name': r['branch_name'],
                'display_id': f"{r['branch_key']}-{r['display_number']}",
                'title': r['label_override'] or r['title'],
                'description': r.get('description') or '',
                'status': r['status'],
                'status_label': r['status_label'],
                'status_color': r['status_color'],
                'status_category': r['status_category'],
                'priority': r['priority'],
                'start_date': r['start_date'].isoformat() if r['start_date'] else None,
                'due_date': r['due_date'].isoformat() if r['due_date'] else None,
            })
            accessible_task_ids.append(r['task_id'])
        items.append(item)

    # 담당자 일괄 hydrate (접근 가능한 task에 한해)
    if accessible_task_ids:
        assignees_result = await db.execute(text("""
            SELECT ta.task_id, ta.user_id, u.username, u.avatar_url, u.avatar_color, ta.role
            FROM task_assignee ta
            INNER JOIN "user" u ON ta.user_id = u.user_id
            WHERE ta.task_id = ANY(:ids)
              AND u.deleted_at IS NULL
            ORDER BY ta.role, u.username
        """), {'ids': accessible_task_ids})
        assignee_map = {}
        for ar in assignees_result.fetchall():
            ad = dict(ar._mapping)
            assignee_map.setdefault(ad['task_id'], []).append({
                'user_id': ad['user_id'],
                'username': ad['username'],
                'avatar_url': ad.get('avatar_url'),
                'avatar_color': ad.get('avatar_color'),
                'role': ad['role'],
            })
        for item in items:
            if not item.get('restricted'):
                item['assignees'] = assignee_map.get(item['task_id'], [])

        # Other tracks — 같은 task를 참조하는 다른 track 목록 (사용자가 멤버인 것만)
        other_result = await db.execute(text("""
            SELECT ti.source_task_id AS task_id, t.track_id, t.track_name, t.color
            FROM track_item ti
            INNER JOIN track t ON ti.track_id = t.track_id
            INNER JOIN track_member tm
                ON tm.track_id = t.track_id AND tm.user_id = :user_id
            WHERE ti.source_type = 'task'
              AND ti.source_task_id = ANY(:ids)
              AND ti.track_id != :track_id
            ORDER BY t.track_name
        """), {'ids': accessible_task_ids, 'user_id': user_id, 'track_id': track_id})
        other_map = {}
        for orow in other_result.fetchall():
            od = dict(orow._mapping)
            other_map.setdefault(od['task_id'], []).append({
                'track_id': od['track_id'],
                'track_name': od['track_name'],
                'color': od['color'],
            })
        for item in items:
            if not item.get('restricted'):
                item['other_tracks'] = other_map.get(item['task_id'], [])

    return items


async def update_positions(track_id: int, positions: list, db: AsyncSession):
    """[{item_id, position_x, position_y}] bulk 업데이트 (단일 쿼리). track_id 가드.
    f-string은 placeholder 이름만(:i0,:x0,...) 만들고 모든 값은 bind parameter로 전달.
    첫 row 에만 CAST를 박아 asyncpg가 VALUES의 컬럼 타입을 추론하게 함
    (없으면 'operator does not exist: integer = text' 에러).
    """
    if not positions:
        return
    placeholders = []
    params = {'track_id': track_id}
    for i, p in enumerate(positions):
        if i == 0:
            placeholders.append(
                f'(CAST(:i{i} AS INTEGER), CAST(:x{i} AS DOUBLE PRECISION), CAST(:y{i} AS DOUBLE PRECISION))'
            )
        else:
            placeholders.append(f'(:i{i}, :x{i}, :y{i})')
        params[f'i{i}'] = p['item_id']
        params[f'x{i}'] = p['position_x']
        params[f'y{i}'] = p['position_y']
    values_clause = ', '.join(placeholders)
    await db.execute(text(f"""
        UPDATE track_item AS ti
        SET position_x = v.px, position_y = v.py
        FROM (VALUES {values_clause}) AS v(item_id, px, py)
        WHERE ti.item_id = v.item_id AND ti.track_id = :track_id
    """), params)


async def delete(item_id: int, track_id: int, db: AsyncSession):
    """item 삭제 (track_id 가드)"""
    await db.execute(text("""
        DELETE FROM track_item
        WHERE item_id = :item_id AND track_id = :track_id
    """), {'item_id': item_id, 'track_id': track_id})


async def find_materialized_dep_ids_for_branch(track_id: int, branch_id: int,
                                                 db: AsyncSession):
    """branch unparticipate 시 정리할 task_dependency id 목록.
    이 branch에서 온 item이 source/target인 link 중 materialize된 것."""
    result = await db.execute(text("""
        SELECT DISTINCT tl.materialized_dependency_id
        FROM track_link tl
        INNER JOIN track_item s ON tl.source_item_id = s.item_id
        INNER JOIN track_item t ON tl.target_item_id = t.item_id
        WHERE tl.track_id = :track_id
          AND tl.materialized_dependency_id IS NOT NULL
          AND (
            s.source_task_id IN (SELECT task_id FROM task WHERE branch_id = :branch_id)
            OR t.source_task_id IN (SELECT task_id FROM task WHERE branch_id = :branch_id)
          )
    """), {'track_id': track_id, 'branch_id': branch_id})
    return [r[0] for r in result.fetchall()]


async def delete_by_track_branch(track_id: int, branch_id: int, db: AsyncSession):
    """Track에서 특정 branch의 task를 참조하는 모든 item 삭제 (track_link는 FK CASCADE)."""
    await db.execute(text("""
        DELETE FROM track_item
        WHERE track_id = :track_id
          AND source_type = 'task'
          AND source_task_id IN (
              SELECT task_id FROM task WHERE branch_id = :branch_id
          )
    """), {'track_id': track_id, 'branch_id': branch_id})


async def search_sources(track_id: int, user_id: int, q: str, branch_id,
                         limit: int, db: AsyncSession,
                         status=None, priority=None,
                         assignee_user_id=None, label_id=None,
                         status_category=None,
                         include_non_participating: bool = False,
                         epic_id=None, sprint_id=None,
                         parent_only: bool = False,
                         exclude_done: bool = False):
    """Track의 task 검색.
    기본: participating branches로 제한 (SourcePicker 자동 검색).
    include_non_participating=True: 사용자가 멤버인 모든 branch에서 검색 (BulkAdd 모드).
    epic_id/sprint_id: BulkAdd Epic/Sprint 모드용 필터.
    parent_only / exclude_done: BulkAdd UX — subtask와 done/cancelled 기본 제외.
    어느 경우든 branch_member INNER JOIN으로 접근 권한은 보장됨.
    """
    keyword_like = f'%{q}%' if q else '%'
    participating_join = (
        "INNER JOIN track_branch tb ON tb.track_id = :track_id AND tb.branch_id = t.branch_id"
        if not include_non_participating else ""
    )
    parent_only_clause = "AND t.parent_task_id IS NULL" if parent_only else ""
    # workflow_status에 매핑되지 않은 상태(ws.category IS NULL)는 "알 수 없음" — 안전하게 통과시킴
    exclude_done_clause = (
        "AND (ws.category IS NULL OR ws.category NOT IN ('done', 'cancelled'))"
        if exclude_done else ""
    )
    result = await db.execute(text(f"""
        SELECT
            t.task_id, t.title, t.display_number,
            t.status, t.priority,
            b.branch_id, b.branch_name, b.key AS branch_key, b.color AS branch_color,
            ws.label AS status_label, ws.color AS status_color, ws.category AS status_category,
            EXISTS (
                SELECT 1 FROM track_item ti
                WHERE ti.track_id = :track_id
                  AND ti.source_type = 'task'
                  AND ti.source_task_id = t.task_id
            ) AS in_track
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        {participating_join}
        INNER JOIN branch_member bm
            ON bm.branch_id = t.branch_id AND bm.user_id = :user_id
        LEFT JOIN workflow_status ws
            ON ws.branch_id = t.branch_id AND ws.key = t.status
        WHERE (t.title ILIKE :q OR (b.key || '-' || t.display_number) ILIKE :q)
          AND b.is_archived = FALSE
          AND (CAST(:branch_id AS INTEGER) IS NULL OR t.branch_id = CAST(:branch_id AS INTEGER))
          AND (CAST(:epic_id AS INTEGER) IS NULL OR t.epic_id = CAST(:epic_id AS INTEGER))
          AND (CAST(:sprint_id AS INTEGER) IS NULL OR t.sprint_id = CAST(:sprint_id AS INTEGER))
          AND (CAST(:status AS TEXT) IS NULL OR t.status = CAST(:status AS TEXT))
          AND (CAST(:status_category AS TEXT) IS NULL OR ws.category = CAST(:status_category AS TEXT))
          AND (CAST(:priority AS TEXT) IS NULL OR t.priority = CAST(:priority AS TEXT))
          AND (CAST(:assignee_user_id AS INTEGER) IS NULL OR EXISTS (
              SELECT 1 FROM task_assignee ta
              WHERE ta.task_id = t.task_id
                AND ta.user_id = CAST(:assignee_user_id AS INTEGER)
          ))
          AND (CAST(:label_id AS INTEGER) IS NULL OR EXISTS (
              SELECT 1 FROM task_label tl
              WHERE tl.task_id = t.task_id
                AND tl.label_id = CAST(:label_id AS INTEGER)
          ))
          {parent_only_clause}
          {exclude_done_clause}
        ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC
        LIMIT :limit
    """), {
        'track_id': track_id,
        'user_id': user_id,
        'q': keyword_like,
        'branch_id': branch_id,
        'epic_id': epic_id,
        'sprint_id': sprint_id,
        'status': status,
        'status_category': status_category,
        'priority': priority,
        'assignee_user_id': assignee_user_id,
        'label_id': label_id,
        'limit': limit,
    })

    rows = []
    for r in result.fetchall():
        d = dict(r._mapping)
        d['display_id'] = f"{d['branch_key']}-{d['display_number']}"
        rows.append(d)
    return rows
