from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def upsert(user_id: int, endpoint: str, p256dh: str, auth: str,
                 db: AsyncSession):
    """구독 저장 (동일 endpoint면 업데이트)"""
    await db.execute(text("""
        INSERT INTO push_subscription (user_id, endpoint, p256dh, auth)
        VALUES (:user_id, :endpoint, :p256dh, :auth)
        ON CONFLICT (endpoint) DO UPDATE
        SET user_id = :user_id, p256dh = :p256dh, auth = :auth
    """), {
        'user_id': user_id, 'endpoint': endpoint,
        'p256dh': p256dh, 'auth': auth,
    })
    await db.commit()


async def find_by_user(user_id: int, db: AsyncSession) -> list[dict]:
    """사용자의 모든 Push 구독 조회"""
    result = await db.execute(text("""
        SELECT endpoint, p256dh, auth
        FROM push_subscription
        WHERE user_id = :user_id
    """), {'user_id': user_id})
    return [dict(r._mapping) for r in result.fetchall()]


async def delete_by_endpoint(endpoint: str, db: AsyncSession):
    """특정 구독 삭제 (만료 등)"""
    await db.execute(text("""
        DELETE FROM push_subscription WHERE endpoint = :endpoint
    """), {'endpoint': endpoint})
    await db.commit()
