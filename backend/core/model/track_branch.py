from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def add(track_id: int, branch_id: int, db: AsyncSession):
    """Track 참여 branch 추가 (idempotent)"""
    await db.execute(text("""
        INSERT INTO track_branch (track_id, branch_id)
        VALUES (:track_id, :branch_id)
        ON CONFLICT (track_id, branch_id) DO NOTHING
    """), {'track_id': track_id, 'branch_id': branch_id})


async def remove(track_id: int, branch_id: int, db: AsyncSession):
    await db.execute(text("""
        DELETE FROM track_branch
        WHERE track_id = :track_id AND branch_id = :branch_id
    """), {'track_id': track_id, 'branch_id': branch_id})


async def find_by_track(track_id: int, db: AsyncSession):
    """Track의 참여 branch 목록 + 사용자 정의 override"""
    result = await db.execute(text("""
        SELECT tb.branch_id, tb.display_name_override, tb.color_override,
               tb.added_at,
               b.branch_name AS branch_real_name,
               b.key AS branch_key,
               b.color AS branch_real_color,
               b.icon
        FROM track_branch tb
        INNER JOIN branch b ON tb.branch_id = b.branch_id
        WHERE tb.track_id = :track_id AND b.is_archived = FALSE
        ORDER BY b.branch_name
    """), {'track_id': track_id})
    rows = [dict(r._mapping) for r in result.fetchall()]
    # display_name / color는 override가 있으면 그쪽으로
    for r in rows:
        r['display_name'] = r['display_name_override'] or r['branch_real_name']
        r['color'] = r['color_override'] or r['branch_real_color']
    return rows


async def is_participating(track_id: int, branch_id: int, db: AsyncSession) -> bool:
    result = await db.execute(text("""
        SELECT 1 FROM track_branch
        WHERE track_id = :track_id AND branch_id = :branch_id
    """), {'track_id': track_id, 'branch_id': branch_id})
    return result.fetchone() is not None


async def update_override(track_id: int, branch_id: int, fields: dict, db: AsyncSession):
    """display_name_override / color_override 만 수정"""
    allowed = {'display_name_override', 'color_override'}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    set_clause = ', '.join(f'{k} = :{k}' for k in updates)
    params = {**updates, 'track_id': track_id, 'branch_id': branch_id}
    await db.execute(text(f"""
        UPDATE track_branch SET {set_clause}
        WHERE track_id = :track_id AND branch_id = :branch_id
    """), params)
