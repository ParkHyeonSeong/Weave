from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# Track 멤버 권한 단계 (낮음 → 높음)
ROLE_LEVELS = {'viewer': 1, 'editor': 2, 'owner': 3}


async def add(track_id: int, user_id: int, role: str, db: AsyncSession):
    """Track 멤버 추가 (이미 있으면 무시)"""
    await db.execute(text("""
        INSERT INTO track_member (track_id, user_id, role)
        VALUES (:track_id, :user_id, :role)
        ON CONFLICT (track_id, user_id) DO NOTHING
    """), {'track_id': track_id, 'user_id': user_id, 'role': role})


async def is_member(track_id: int, user_id: int, db: AsyncSession) -> bool:
    result = await db.execute(text("""
        SELECT 1 FROM track_member
        WHERE track_id = :track_id AND user_id = :user_id
    """), {'track_id': track_id, 'user_id': user_id})
    return result.fetchone() is not None


async def get_role(track_id: int, user_id: int, db: AsyncSession):
    """사용자의 Track 내 role 반환 (없으면 None)"""
    result = await db.execute(text("""
        SELECT role FROM track_member
        WHERE track_id = :track_id AND user_id = :user_id
    """), {'track_id': track_id, 'user_id': user_id})
    row = result.fetchone()
    return row._mapping['role'] if row else None


async def find_by_track(track_id: int, db: AsyncSession):
    """Track 멤버 목록"""
    result = await db.execute(text("""
        SELECT tm.user_id, tm.role, tm.joined_at,
               u.username, u.email, u.avatar_url, u.avatar_color
        FROM track_member tm
        INNER JOIN "user" u ON tm.user_id = u.user_id
        WHERE tm.track_id = :track_id
        ORDER BY
            CASE tm.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,
            tm.joined_at
    """), {'track_id': track_id})
    return [dict(r._mapping) for r in result.fetchall()]


async def update_role(track_id: int, user_id: int, role: str, db: AsyncSession):
    await db.execute(text("""
        UPDATE track_member SET role = :role
        WHERE track_id = :track_id AND user_id = :user_id
    """), {'track_id': track_id, 'user_id': user_id, 'role': role})


async def remove(track_id: int, user_id: int, db: AsyncSession):
    await db.execute(text("""
        DELETE FROM track_member
        WHERE track_id = :track_id AND user_id = :user_id
    """), {'track_id': track_id, 'user_id': user_id})


async def count_owners(track_id: int, db: AsyncSession) -> int:
    """마지막 owner 보호용"""
    result = await db.execute(text("""
        SELECT COUNT(*) FROM track_member
        WHERE track_id = :track_id AND role = 'owner'
    """), {'track_id': track_id})
    return result.scalar_one()


async def search_non_members(track_id: int, query: str, db: AsyncSession):
    """초대 가능한 사용자 검색 (아직 멤버가 아닌 active 유저, username/email ILIKE)"""
    result = await db.execute(text("""
        SELECT u.user_id, u.username, u.email, u.avatar_url, u.avatar_color
        FROM "user" u
        WHERE u.status = 'active'
          AND u.user_id NOT IN (
              SELECT user_id FROM track_member WHERE track_id = :track_id
          )
          AND (u.username ILIKE :q OR u.email ILIKE :q)
        ORDER BY u.username
        LIMIT 10
    """), {'track_id': track_id, 'q': f'%{query}%'})
    return [dict(r._mapping) for r in result.fetchall()]


def has_at_least(role: str, required: str) -> bool:
    """role이 required 이상인지 (owner > editor > viewer)"""
    return ROLE_LEVELS.get(role, 0) >= ROLE_LEVELS.get(required, 0)
