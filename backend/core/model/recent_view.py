from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def upsert(user_id: int, item_type: str, item_id: int, db: AsyncSession):
    """최근 조회 기록 upsert (있으면 시간만 갱신)"""
    await db.execute(text("""
        INSERT INTO recent_view (user_id, item_type, item_id, viewed_at)
        VALUES (:user_id, :item_type, :item_id, NOW())
        ON CONFLICT (user_id, item_type, item_id)
        DO UPDATE SET viewed_at = NOW()
    """), {'user_id': user_id, 'item_type': item_type, 'item_id': item_id})


async def find_recent(user_id: int, limit: int, db: AsyncSession, item_type: str | None = None):
    """최근 조회 항목 (태스크 + 문서 통합, item_type으로 필터 가능)"""
    # 현재 멤버십으로 재스코핑: 멤버십을 상실한 항목의 최신 메타데이터가 새는 것을 막는다.
    # 통합 쿼리(task+doc)이므로 타입별 멤버십 필터를 건다 — 단일 INNER JOIN은
    # 반대 타입 행을 통째로 날린다. (RECENT-VIEW-LEAK)
    where = """
        WHERE rv.user_id = :user_id
          AND (
            (rv.item_type = 'task' AND bm.user_id IS NOT NULL)
            OR (rv.item_type = 'doc' AND cm.user_id IS NOT NULL)
          )
    """
    params = {'user_id': user_id, 'limit': limit}
    if item_type:
        where += " AND rv.item_type = :item_type"
        params['item_type'] = item_type

    result = await db.execute(text(f"""
        SELECT rv.item_type, rv.item_id, rv.viewed_at,
               t.task_id, t.branch_id, t.display_number, t.title AS task_title,
               t.status AS task_status,
               ws.color AS status_color, ws.category AS status_category,
               b.key AS branch_key,
               cp.page_id, cp.canvas_id, cp.title AS page_title,
               c.canvas_name
        FROM recent_view rv
        LEFT JOIN task t ON rv.item_type = 'task' AND rv.item_id = t.task_id
        LEFT JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN branch_member bm ON bm.branch_id = t.branch_id AND bm.user_id = :user_id
        LEFT JOIN workflow_status ws ON ws.branch_id = t.branch_id AND ws.key = t.status
        LEFT JOIN canvas_page cp ON rv.item_type = 'doc' AND rv.item_id = cp.page_id
            AND cp.is_archived = FALSE
        LEFT JOIN canvas_member cm ON cm.canvas_id = cp.canvas_id AND cm.user_id = :user_id
        LEFT JOIN canvas c ON cp.canvas_id = c.canvas_id
            AND c.is_archived = FALSE
        {where}
        ORDER BY rv.viewed_at DESC
        LIMIT :limit
    """), params)
    rows = result.fetchall()
    items = []
    for row in rows:
        r = dict(row._mapping)
        if r['item_type'] == 'task' and r['task_id']:
            items.append({
                'type': 'task',
                'task_id': r['task_id'],
                'branch_id': r['branch_id'],
                'display_number': f"{r['branch_key']}-{r['display_number']}",
                'title': r['task_title'],
                'status': r['task_status'],
                'status_color': r['status_color'],
                'status_category': r['status_category'],
                'viewed_at': r['viewed_at'],
            })
        elif r['item_type'] == 'doc' and r['page_id']:
            items.append({
                'type': 'doc',
                'page_id': r['page_id'],
                'canvas_id': r['canvas_id'],
                'title': r['page_title'] or 'Untitled',
                'canvas_name': r['canvas_name'],
                'viewed_at': r['viewed_at'],
            })
    return items
