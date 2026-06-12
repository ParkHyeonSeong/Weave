from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

ROLE_RANK = {'member': 1, 'admin': 2}


def has_at_least(role: str | None, required: str) -> bool:
    """role이 required 이상인지. role이 None(비멤버)이면 False."""
    if not role:
        return False
    return ROLE_RANK.get(role, 0) >= ROLE_RANK.get(required, 0)


async def add(board_id: int, user_id: int, role: str, db: AsyncSession):
    """멤버 추가 (이미 있으면 role 갱신)"""
    await db.execute(text("""
        INSERT INTO scrum_member (board_id, user_id, role)
        VALUES (:board_id, :user_id, :role)
        ON CONFLICT (board_id, user_id) DO UPDATE SET role = EXCLUDED.role
    """), {'board_id': board_id, 'user_id': user_id, 'role': role})


async def get_role(board_id: int, user_id: int, db: AsyncSession) -> str | None:
    result = await db.execute(text("""
        SELECT role FROM scrum_member
        WHERE board_id = :board_id AND user_id = :user_id
    """), {'board_id': board_id, 'user_id': user_id})
    row = result.fetchone()
    return row._mapping['role'] if row else None


async def is_member(board_id: int, user_id: int, db: AsyncSession) -> bool:
    return await get_role(board_id, user_id, db) is not None


async def find_by_board(board_id: int, db: AsyncSession):
    result = await db.execute(text("""
        SELECT sm.user_id, sm.role, sm.joined_at,
               u.username, u.email, u.avatar_url, u.avatar_color
        FROM scrum_member sm
        INNER JOIN "user" u ON u.user_id = sm.user_id
        WHERE sm.board_id = :board_id
          AND u.deleted_at IS NULL
        ORDER BY sm.joined_at
    """), {'board_id': board_id})
    return [dict(r._mapping) for r in result.fetchall()]


async def update_role(board_id: int, user_id: int, role: str, db: AsyncSession):
    await db.execute(text("""
        UPDATE scrum_member SET role = :role
        WHERE board_id = :board_id AND user_id = :user_id
    """), {'board_id': board_id, 'user_id': user_id, 'role': role})


async def remove(board_id: int, user_id: int, db: AsyncSession):
    await db.execute(text("""
        DELETE FROM scrum_member
        WHERE board_id = :board_id AND user_id = :user_id
    """), {'board_id': board_id, 'user_id': user_id})


async def count_admins(board_id: int, db: AsyncSession) -> int:
    result = await db.execute(text("""
        SELECT COUNT(*) FROM scrum_member
        WHERE board_id = :board_id AND role = 'admin'
    """), {'board_id': board_id})
    return result.scalar_one()


async def search_non_members(board_id: int, query: str, db: AsyncSession):
    """초대 가능한 사용자 검색 (아직 멤버 아닌 active 유저, username/email ILIKE, 최대 10)"""
    result = await db.execute(text("""
        SELECT u.user_id, u.username, u.email, u.avatar_url, u.avatar_color
        FROM "user" u
        WHERE u.status = 'active'
          AND u.deleted_at IS NULL
          AND u.user_id NOT IN (SELECT user_id FROM scrum_member WHERE board_id = :board_id)
          AND (u.username ILIKE :q OR u.email ILIKE :q)
        ORDER BY u.username
        LIMIT 10
    """), {'board_id': board_id, 'q': f'%{query}%'})
    return [dict(r._mapping) for r in result.fetchall()]
