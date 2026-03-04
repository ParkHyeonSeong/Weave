from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def add(branch_id: int, user_id: int, role: str, db: AsyncSession):
    """Branch 멤버 추가"""
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:branch_id, :user_id, :role)
    """), {'branch_id': branch_id, 'user_id': user_id, 'role': role})
    await db.commit()


async def find_by_branch(branch_id: int, db: AsyncSession):
    """Branch 멤버 목록"""
    result = await db.execute(text("""
        SELECT bm.user_id, bm.role, bm.joined_at,
               u.username, u.email
        FROM branch_member bm
        INNER JOIN "user" u ON bm.user_id = u.user_id
        WHERE bm.branch_id = :branch_id
        ORDER BY bm.joined_at
    """), {'branch_id': branch_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]
