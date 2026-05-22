from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create_task_ref(track_id: int, task_id: int,
                           position_x: float, position_y: float,
                           db: AsyncSession) -> int:
    """task 참조 item 생성. (track_id, source_task_id) UNIQUE 충돌 시 기존 item_id 반환."""
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
            t.task_id, t.title, t.display_number,
            t.status, t.priority, t.start_date, t.due_date,
            b.branch_id, b.branch_name, b.key AS branch_key, b.color AS branch_color,
            ws.label AS status_label, ws.color AS status_color, ws.category AS status_category,
            CASE WHEN bm.user_id IS NULL THEN TRUE ELSE FALSE END AS restricted
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
                'branch_name': r['branch_name'],
                'display_id': f"{r['branch_key']}-{r['display_number']}",
                'title': r['label_override'] or r['title'],
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
            SELECT ta.task_id, ta.user_id, u.username, u.avatar_url, ta.role
            FROM task_assignee ta
            INNER JOIN "user" u ON ta.user_id = u.user_id
            WHERE ta.task_id = ANY(:ids)
            ORDER BY ta.role, u.username
        """), {'ids': accessible_task_ids})
        assignee_map = {}
        for ar in assignees_result.fetchall():
            ad = dict(ar._mapping)
            assignee_map.setdefault(ad['task_id'], []).append({
                'user_id': ad['user_id'],
                'username': ad['username'],
                'avatar_url': ad.get('avatar_url'),
                'role': ad['role'],
            })
        for item in items:
            if not item.get('restricted'):
                item['assignees'] = assignee_map.get(item['task_id'], [])

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


async def search_sources(track_id: int, user_id: int, q: str, branch_id,
                         limit: int, db: AsyncSession):
    """Track의 participating branches 안에서 task 검색.
    이미 Track에 들어있는 task는 in_track=True로 마킹.
    branch_id 가 주어지면 해당 branch만, NULL로 :branch_id를 넘기면 전체.
    """
    keyword_like = f'%{q}%' if q else '%'
    result = await db.execute(text("""
        SELECT
            t.task_id, t.title, t.display_number,
            t.status, t.priority,
            b.branch_id, b.branch_name, b.key AS branch_key, b.color AS branch_color,
            ws.label AS status_label, ws.color AS status_color,
            EXISTS (
                SELECT 1 FROM track_item ti
                WHERE ti.track_id = :track_id
                  AND ti.source_type = 'task'
                  AND ti.source_task_id = t.task_id
            ) AS in_track
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        INNER JOIN track_branch tb
            ON tb.track_id = :track_id AND tb.branch_id = t.branch_id
        INNER JOIN branch_member bm
            ON bm.branch_id = t.branch_id AND bm.user_id = :user_id
        LEFT JOIN workflow_status ws
            ON ws.branch_id = t.branch_id AND ws.key = t.status
        WHERE (t.title ILIKE :q OR (b.key || '-' || t.display_number) ILIKE :q)
          AND (CAST(:branch_id AS INTEGER) IS NULL OR t.branch_id = CAST(:branch_id AS INTEGER))
        ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC
        LIMIT :limit
    """), {
        'track_id': track_id,
        'user_id': user_id,
        'q': keyword_like,
        'branch_id': branch_id,
        'limit': limit,
    })

    rows = []
    for r in result.fetchall():
        d = dict(r._mapping)
        d['display_id'] = f"{d['branch_key']}-{d['display_number']}"
        rows.append(d)
    return rows
