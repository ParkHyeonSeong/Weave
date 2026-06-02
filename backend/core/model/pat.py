from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(user_id: int, name: str, token_hash: str, token_prefix: str,
                 expires_at: datetime | None, db: AsyncSession) -> int:
    result = await db.execute(text("""
        INSERT INTO personal_access_token (user_id, name, token_hash, token_prefix, expires_at)
        VALUES (:user_id, :name, :token_hash, :token_prefix, :expires_at)
        RETURNING pat_id
    """), {"user_id": user_id, "name": name, "token_hash": token_hash,
           "token_prefix": token_prefix, "expires_at": expires_at})
    return result.scalar_one()


async def find_active_by_hash(token_hash: str, db: AsyncSession):
    result = await db.execute(text("""
        SELECT p.pat_id, p.user_id, u.email, u.username, u.role
        FROM personal_access_token p
        JOIN "user" u ON u.user_id = p.user_id
        WHERE p.token_hash = :token_hash
          AND p.revoked_at IS NULL
          AND (p.expires_at IS NULL OR p.expires_at > now())
          AND u.deleted_at IS NULL
          AND u.status = 'active'
    """), {"token_hash": token_hash})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def list_for_user(user_id: int, db: AsyncSession):
    result = await db.execute(text("""
        SELECT pat_id, name, token_prefix, created_at, last_used_at, expires_at
        FROM personal_access_token
        WHERE user_id = :user_id AND revoked_at IS NULL
        ORDER BY created_at DESC
    """), {"user_id": user_id})
    return [dict(r._mapping) for r in result.fetchall()]


async def touch_last_used(pat_id: int, db: AsyncSession) -> None:
    await db.execute(text("""
        UPDATE personal_access_token
        SET last_used_at = now()
        WHERE pat_id = :pat_id
          AND revoked_at IS NULL
          AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes')
    """), {"pat_id": pat_id})


async def revoke(pat_id: int, user_id: int, db: AsyncSession) -> bool:
    result = await db.execute(text("""
        UPDATE personal_access_token
        SET revoked_at = now()
        WHERE pat_id = :pat_id AND user_id = :user_id AND revoked_at IS NULL
    """), {"pat_id": pat_id, "user_id": user_id})
    return result.rowcount > 0
