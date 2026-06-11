from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(token_hash: str, user_id: int, expires_at: datetime, db: AsyncSession) -> int:
    """재설정 토큰 레코드 생성 (평문 미저장 — 해시만 저장)."""
    result = await db.execute(text("""
        INSERT INTO password_reset_token (token_hash, user_id, expires_at)
        VALUES (:token_hash, :user_id, :expires_at)
        RETURNING token_id
    """), {"token_hash": token_hash, "user_id": user_id, "expires_at": expires_at})
    return result.scalar_one()


async def find_valid_by_hash(token_hash: str, db: AsyncSession):
    """미사용·미만료 토큰을 해시로 조회 (사용자 active 상태 확인)."""
    result = await db.execute(text("""
        SELECT t.token_id, t.user_id, u.email
        FROM password_reset_token t
        JOIN "user" u ON u.user_id = t.user_id
        WHERE t.token_hash = :token_hash
          AND t.used_at IS NULL
          AND t.expires_at > now()
          AND u.deleted_at IS NULL
          AND u.status = 'active'
    """), {"token_hash": token_hash})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def mark_used(token_id: int, db: AsyncSession) -> bool:
    """토큰을 단일사용 처리. 이미 사용됐으면 False (동시성 안전)."""
    result = await db.execute(text("""
        UPDATE password_reset_token
        SET used_at = now()
        WHERE token_id = :token_id AND used_at IS NULL
    """), {"token_id": token_id})
    return result.rowcount > 0
