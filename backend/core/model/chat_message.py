from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(room_id: int, sender_id: int, content: str, db: AsyncSession) -> dict:
    """메시지 생성 및 생성된 메시지 반환"""
    result = await db.execute(text("""
        INSERT INTO chat_message (room_id, sender_id, content)
        VALUES (:room_id, :sender_id, :content)
        RETURNING message_id, room_id, sender_id, content, created_at
    """), {'room_id': room_id, 'sender_id': sender_id, 'content': content})
    await db.commit()
    row = result.fetchone()
    return dict(row._mapping)


async def find_by_room(room_id: int, limit: int, offset: int, db: AsyncSession):
    """채팅방 메시지 목록 (최신순, 페이지네이션)"""
    result = await db.execute(text("""
        SELECT cm.message_id, cm.room_id, cm.sender_id, cm.content, cm.created_at,
               u.username AS sender_name
        FROM chat_message cm
        INNER JOIN "user" u ON cm.sender_id = u.user_id
        WHERE cm.room_id = :room_id
        ORDER BY cm.created_at DESC
        LIMIT :limit OFFSET :offset
    """), {'room_id': room_id, 'limit': limit, 'offset': offset})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]
