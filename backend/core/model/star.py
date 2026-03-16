from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def toggle(user_id: int, item_type: str, item_id: int, db: AsyncSession):
    """star 토글: 있으면 삭제, 없으면 추가"""
    result = await db.execute(text("""
        DELETE FROM user_star
        WHERE user_id = :user_id AND item_type = :item_type AND item_id = :item_id
        RETURNING star_id
    """), {'user_id': user_id, 'item_type': item_type, 'item_id': item_id})
    deleted = result.fetchone()
    if deleted:
        await db.commit()
        return {'starred': False}
    await db.execute(text("""
        INSERT INTO user_star (user_id, item_type, item_id)
        VALUES (:user_id, :item_type, :item_id)
    """), {'user_id': user_id, 'item_type': item_type, 'item_id': item_id})
    await db.commit()
    return {'starred': True}


async def is_starred(user_id: int, item_type: str, item_id: int, db: AsyncSession) -> bool:
    """star 여부 확인"""
    result = await db.execute(text("""
        SELECT 1 FROM user_star
        WHERE user_id = :user_id AND item_type = :item_type AND item_id = :item_id
    """), {'user_id': user_id, 'item_type': item_type, 'item_id': item_id})
    return result.fetchone() is not None


async def find_starred(user_id: int, limit: int, db: AsyncSession, item_type: str | None = None):
    """사용자의 star 목록 (태스크 + 문서 통합, item_type으로 필터 가능)"""
    where = "WHERE us.user_id = :user_id"
    params = {'user_id': user_id, 'limit': limit}
    if item_type:
        where += " AND us.item_type = :item_type"
        params['item_type'] = item_type

    result = await db.execute(text(f"""
        SELECT us.item_type, us.item_id, us.created_at,
               t.task_id, t.branch_id, t.display_number, t.title AS task_title,
               t.status AS task_status,
               b.key AS branch_key,
               cp.page_id, cp.canvas_id, cp.title AS page_title,
               c.canvas_name
        FROM user_star us
        LEFT JOIN task t ON us.item_type = 'task' AND us.item_id = t.task_id
        LEFT JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN canvas_page cp ON us.item_type = 'doc' AND us.item_id = cp.page_id
            AND cp.is_archived = FALSE
        LEFT JOIN canvas c ON cp.canvas_id = c.canvas_id
            AND c.is_archived = FALSE
        {where}
        ORDER BY us.created_at DESC
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
                'starred_at': r['created_at'],
            })
        elif r['item_type'] == 'doc' and r['page_id']:
            items.append({
                'type': 'doc',
                'page_id': r['page_id'],
                'canvas_id': r['canvas_id'],
                'title': r['page_title'] or 'Untitled',
                'canvas_name': r['canvas_name'],
                'starred_at': r['created_at'],
            })
    return items
