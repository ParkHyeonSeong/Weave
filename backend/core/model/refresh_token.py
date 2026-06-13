"""Refresh 토큰 저장소 (SEC-29).

평문은 저장하지 않고 해시만 보관한다(PAT/비밀번호 재설정 토큰과 동일 패턴). 행 삭제가
즉시 폐기(revoke)를 의미한다 — 로그아웃은 해당 토큰을, 비밀번호 재설정은 사용자의 전체
토큰을 삭제해 모든 세션을 무효화한다.
"""
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(user_id: int, token_hash: str, expires_at: datetime, db: AsyncSession) -> int:
    result = await db.execute(text("""
        INSERT INTO refresh_token (user_id, token_hash, expires_at)
        VALUES (:user_id, :token_hash, :expires_at)
        RETURNING token_id
    """), {'user_id': user_id, 'token_hash': token_hash, 'expires_at': expires_at})
    return result.scalar_one()


async def find_active_by_hash(token_hash: str, db: AsyncSession) -> dict | None:
    """미만료 refresh 토큰을 해시로 조회. 만료/미존재면 None."""
    result = await db.execute(text("""
        SELECT token_id, user_id FROM refresh_token
        WHERE token_hash = :token_hash AND expires_at > NOW()
    """), {'token_hash': token_hash})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def consume_by_hash(token_hash: str, db: AsyncSession) -> dict | None:
    """미만료 토큰을 원자적으로 소비(삭제하며 반환). 회전 시 사용 — DELETE 자체가 뮤텍스라
    같은 토큰으로 동시에 들어온 요청 중 하나만 통과한다(재사용/탈취 경합 차단)."""
    result = await db.execute(text("""
        DELETE FROM refresh_token
        WHERE token_hash = :token_hash AND expires_at > NOW()
        RETURNING token_id, user_id
    """), {'token_hash': token_hash})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def delete_by_hash(token_hash: str, db: AsyncSession):
    """단일 토큰 폐기(로그아웃 시 기존 토큰 제거)."""
    await db.execute(text("""
        DELETE FROM refresh_token WHERE token_hash = :token_hash
    """), {'token_hash': token_hash})


async def delete_all_for_user(user_id: int, db: AsyncSession):
    """사용자의 모든 refresh 토큰 폐기(비밀번호 재설정 등 — 전 세션 무효화)."""
    await db.execute(text("""
        DELETE FROM refresh_token WHERE user_id = :user_id
    """), {'user_id': user_id})


async def purge_expired(db: AsyncSession) -> int:
    """만료된 토큰 정리. 삭제 개수 반환(주기 청소용)."""
    result = await db.execute(text("""
        DELETE FROM refresh_token WHERE expires_at <= NOW()
    """))
    return result.rowcount or 0
