from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def add(room_id: int, user_id: int, db: AsyncSession):
    """채팅방 멤버 추가"""
    await db.execute(text("""
        INSERT INTO chat_room_member (room_id, user_id)
        VALUES (:room_id, :user_id)
        ON CONFLICT DO NOTHING
    """), {'room_id': room_id, 'user_id': user_id})


async def find_by_room(room_id: int, db: AsyncSession):
    """채팅방 멤버 목록"""
    result = await db.execute(text("""
        SELECT crm.user_id, crm.joined_at, crm.last_read_at,
               u.username, u.email, u.avatar_url, u.avatar_color
        FROM chat_room_member crm
        INNER JOIN "user" u ON crm.user_id = u.user_id
        WHERE crm.room_id = :room_id
          AND u.deleted_at IS NULL
        ORDER BY crm.joined_at
    """), {'room_id': room_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def is_member(room_id: int, user_id: int, db: AsyncSession) -> bool:
    """사용자가 해당 방의 멤버인지 확인"""
    result = await db.execute(text("""
        SELECT 1 FROM chat_room_member
        WHERE room_id = :room_id AND user_id = :user_id
    """), {'room_id': room_id, 'user_id': user_id})
    return result.fetchone() is not None


async def search_room_members(room_id: int, query: str, exclude_user_id: int,
                               limit: int = 10, db: AsyncSession = None):
    """채팅방 멤버 중 username 검색 (본인 제외) — @멘션용. 이름·아바타만, 활성·비삭제 멤버만."""
    result = await db.execute(text("""
        SELECT u.user_id, u.username, u.avatar_url, u.avatar_color
        FROM chat_room_member crm
        INNER JOIN "user" u ON crm.user_id = u.user_id
        WHERE crm.room_id = :room_id
          AND u.user_id != :exclude_user_id
          AND u.status = 'active'
          AND u.deleted_at IS NULL
          AND u.username ILIKE :q
        ORDER BY u.username
        LIMIT :limit
    """), {'room_id': room_id, 'exclude_user_id': exclude_user_id,
           'q': f'%{query}%', 'limit': limit})
    return [dict(r._mapping) for r in result.fetchall()]


async def update_last_read(room_id: int, user_id: int, db: AsyncSession):
    """마지막 읽은 시간 갱신"""
    await db.execute(text("""
        UPDATE chat_room_member
        SET last_read_at = NOW()
        WHERE room_id = :room_id AND user_id = :user_id
    """), {'room_id': room_id, 'user_id': user_id})
