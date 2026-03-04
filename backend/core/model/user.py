from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(email: str, password_hash: bytes, username: str, db: AsyncSession) -> int:
    """사용자 생성"""
    result = await db.execute(text("""
        INSERT INTO "user" (email, password, username)
        VALUES (:email, :password, :username)
        RETURNING user_id
    """), {'email': email, 'password': password_hash, 'username': username})
    await db.commit()
    return result.scalar_one()


async def find_by_email(email: str, db: AsyncSession):
    """이메일로 사용자 조회"""
    result = await db.execute(text("""
        SELECT user_id, email, password, username, role, created_at
        FROM "user"
        WHERE email = :email
    """), {'email': email})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def update_role(user_id: int, role: str, db: AsyncSession):
    """사용자 역할 변경"""
    await db.execute(text("""
        UPDATE "user"
        SET role = :role
        WHERE user_id = :user_id
    """), {'user_id': user_id, 'role': role})
    await db.commit()


async def update_login(user_id: int, ip: str, db: AsyncSession):
    """로그인 시간/IP 갱신"""
    await db.execute(text("""
        UPDATE "user"
        SET last_login_at = NOW(), last_login_ip = :ip
        WHERE user_id = :user_id
    """), {'user_id': user_id, 'ip': ip})
    await db.commit()
