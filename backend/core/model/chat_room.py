from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(room_type: str, room_name: str | None, created_by: int,
                 db: AsyncSession) -> int:
    """채팅방 생성"""
    result = await db.execute(text("""
        INSERT INTO chat_room (room_type, room_name, created_by)
        VALUES (:room_type, :room_name, :created_by)
        RETURNING room_id
    """), {'room_type': room_type, 'room_name': room_name, 'created_by': created_by})
    return result.scalar_one()


async def find_by_id(room_id: int, db: AsyncSession):
    """채팅방 상세 조회"""
    result = await db.execute(text("""
        SELECT room_id, room_type, room_name, created_by, created_at
        FROM chat_room
        WHERE room_id = :room_id
    """), {'room_id': room_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_rooms_by_user(user_id: int, db: AsyncSession):
    """사용자가 참여 중인 채팅방 목록 (unread_count, last_message, DM 상대방 정보 포함)"""
    result = await db.execute(text("""
        SELECT cr.room_id, cr.room_type, cr.room_name, cr.created_at,
               crm.last_read_at,
               (SELECT COUNT(*) FROM chat_message cm
                WHERE cm.room_id = cr.room_id
                  AND cm.created_at > COALESCE(crm.last_read_at, '1970-01-01')
                  AND cm.sender_id != :user_id) AS unread_count,
               (SELECT COALESCE(NULLIF(TRIM(cm2.content), ''),
                    CASE WHEN cm2.task_id IS NOT NULL THEN 'Shared a task'
                         WHEN cm2.canvas_page_id IS NOT NULL THEN 'Shared a document'
                         WHEN cm2.issue_id IS NOT NULL THEN 'Shared an issue'
                         WHEN EXISTS (SELECT 1 FROM chat_attachment ca
                                      WHERE ca.message_id = cm2.message_id) THEN 'Sent a file'
                         ELSE NULL END)
                FROM chat_message cm2
                WHERE cm2.room_id = cr.room_id
                ORDER BY cm2.created_at DESC LIMIT 1) AS last_message,
               (SELECT cm3.created_at FROM chat_message cm3
                WHERE cm3.room_id = cr.room_id
                ORDER BY cm3.created_at DESC LIMIT 1) AS last_message_at,
               dmp.user_id AS dm_partner_id,
               dmp.username AS dm_partner_name,
               dmp.avatar_url AS dm_partner_avatar_url,
               dmp.avatar_color AS dm_partner_avatar_color,
               dmp.last_read_at AS dm_partner_last_read_at
        FROM chat_room cr
        INNER JOIN chat_room_member crm ON cr.room_id = crm.room_id
        -- DM 상대(이름·아바타·읽음시각)를 한 행에서 일관되게 — 여러 서브쿼리가
        -- 서로 다른 멤버로 갈라지는 것 방지(상대가 둘 이상이어도 같은 행 사용)
        LEFT JOIN LATERAL (
            SELECT u.user_id, u.username, u.avatar_url, u.avatar_color, dmm.last_read_at
            FROM chat_room_member dmm
            INNER JOIN "user" u ON dmm.user_id = u.user_id
            WHERE dmm.room_id = cr.room_id AND dmm.user_id != :user_id
            LIMIT 1
        ) dmp ON cr.room_type = 'dm'
        WHERE crm.user_id = :user_id
          AND EXISTS (SELECT 1 FROM chat_message cm4
                      WHERE cm4.room_id = cr.room_id)
        ORDER BY last_message_at DESC NULLS LAST, cr.created_at DESC
    """), {'user_id': user_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def update_room_name(room_id: int, room_name: str, db: AsyncSession):
    """채팅방 이름 변경"""
    await db.execute(text("""
        UPDATE chat_room SET room_name = :room_name WHERE room_id = :room_id
    """), {'room_id': room_id, 'room_name': room_name})


async def find_dm_room(user_id_1: int, user_id_2: int, db: AsyncSession):
    """두 사용자 간 기존 DM방 찾기"""
    result = await db.execute(text("""
        SELECT cr.room_id
        FROM chat_room cr
        WHERE cr.room_type = 'dm'
          AND EXISTS (
            SELECT 1 FROM chat_room_member crm1
            WHERE crm1.room_id = cr.room_id AND crm1.user_id = :user_id_1
          )
          AND EXISTS (
            SELECT 1 FROM chat_room_member crm2
            WHERE crm2.room_id = cr.room_id AND crm2.user_id = :user_id_2
          )
        LIMIT 1
    """), {'user_id_1': user_id_1, 'user_id_2': user_id_2})
    row = result.fetchone()
    return row[0] if row else None
