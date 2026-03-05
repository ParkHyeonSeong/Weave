from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(email: str, password_hash: bytes, username: str, db: AsyncSession, status: str = 'active') -> int:
    """사용자 생성"""
    result = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:email, :password, :username, :status)
        RETURNING user_id
    """), {'email': email, 'password': password_hash, 'username': username, 'status': status})
    await db.commit()
    return result.scalar_one()


async def find_by_email(email: str, db: AsyncSession):
    """이메일로 사용자 조회"""
    result = await db.execute(text("""
        SELECT user_id, email, password, username, role, status, created_at
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


async def find_all(db: AsyncSession):
    """전체 사용자 목록 (비밀번호 제외)"""
    result = await db.execute(text("""
        SELECT user_id, email, username, role, status, created_at, last_login_at
        FROM "user"
        ORDER BY created_at DESC
    """))
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def find_by_id(user_id: int, db: AsyncSession):
    """사용자 ID로 조회 (비밀번호 제외)"""
    result = await db.execute(text("""
        SELECT user_id, email, username, role, status, created_at, last_login_at
        FROM "user"
        WHERE user_id = :user_id
    """), {'user_id': user_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def update_status(user_id: int, status: str, db: AsyncSession):
    """사용자 상태 변경 (active, pending, rejected)"""
    await db.execute(text("""
        UPDATE "user"
        SET status = :status
        WHERE user_id = :user_id
    """), {'user_id': user_id, 'status': status})
    await db.commit()
