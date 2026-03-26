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
        SELECT user_id, email, password, username, role, status, created_at, must_change_password
        FROM "user"
        WHERE email = :email AND deleted_at IS NULL
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
    """전체 사용자 목록 (비밀번호 제외, 삭제된 사용자 제외)"""
    result = await db.execute(text("""
        SELECT user_id, email, username, role, status, avatar_url, created_at, last_login_at
        FROM "user"
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC
    """))
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def find_by_id(user_id: int, db: AsyncSession):
    """사용자 ID로 조회 (비밀번호 제외)"""
    result = await db.execute(text("""
        SELECT user_id, email, username, role, status, avatar_url, created_at, last_login_at
        FROM "user"
        WHERE user_id = :user_id
    """), {'user_id': user_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_by_id_with_password(user_id: int, db: AsyncSession):
    """사용자 ID로 조회 (비밀번호 포함, 비밀번호 검증용)"""
    result = await db.execute(text("""
        SELECT user_id, email, password, username, role, status, avatar_url
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


async def update_username(user_id: int, username: str, db: AsyncSession):
    """사용자 이름 변경"""
    await db.execute(text("""
        UPDATE "user"
        SET username = :username
        WHERE user_id = :user_id
    """), {'user_id': user_id, 'username': username})
    await db.commit()


async def update_password(user_id: int, password_hash: bytes, db: AsyncSession):
    """비밀번호 변경 (must_change_password 플래그도 해제)"""
    await db.execute(text("""
        UPDATE "user"
        SET password = :password, must_change_password = FALSE
        WHERE user_id = :user_id
    """), {'user_id': user_id, 'password': password_hash})
    await db.commit()


async def set_must_change_password(user_id: int, flag: bool, db: AsyncSession):
    """비밀번호 변경 강제 플래그 설정"""
    await db.execute(text("""
        UPDATE "user"
        SET must_change_password = :flag
        WHERE user_id = :user_id
    """), {'user_id': user_id, 'flag': flag})
    await db.commit()


async def search_active(query: str, exclude_user_id: int, limit: int = 10,
                         db: AsyncSession = None):
    """active 사용자 중 username 검색 (본인 제외)"""
    result = await db.execute(text("""
        SELECT user_id, username, email
        FROM "user"
        WHERE status = 'active'
          AND deleted_at IS NULL
          AND user_id != :exclude_user_id
          AND username ILIKE :q
        ORDER BY username
        LIMIT :limit
    """), {'exclude_user_id': exclude_user_id, 'q': f'%{query}%', 'limit': limit})
    return [dict(r._mapping) for r in result.fetchall()]


async def soft_delete(user_id: int, db: AsyncSession):
    """사용자 소프트 삭제"""
    await db.execute(text("""
        UPDATE "user"
        SET deleted_at = NOW()
        WHERE user_id = :user_id
    """), {'user_id': user_id})
    await db.commit()


async def update_avatar(user_id: int, avatar_url: str, db: AsyncSession):
    """아바타 URL 변경"""
    await db.execute(text("""
        UPDATE "user"
        SET avatar_url = :avatar_url
        WHERE user_id = :user_id
    """), {'user_id': user_id, 'avatar_url': avatar_url})
    await db.commit()


async def get_sidebar_order(user_id: int, db: AsyncSession):
    """사이드바 순서 조회"""
    result = await db.execute(text("""
        SELECT sidebar_order FROM "user" WHERE user_id = :user_id
    """), {'user_id': user_id})
    row = result.fetchone()
    return row._mapping['sidebar_order'] if row else None


async def update_sidebar_order(user_id: int, sidebar_order: dict, db: AsyncSession):
    """사이드바 순서 저장"""
    await db.execute(text("""
        UPDATE "user"
        SET sidebar_order = CAST(:sidebar_order AS jsonb)
        WHERE user_id = :user_id
    """), {'user_id': user_id, 'sidebar_order': __import__('json').dumps(sidebar_order)})
    await db.commit()
