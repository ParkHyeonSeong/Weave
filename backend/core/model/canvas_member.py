from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def add(canvas_id: int, user_id: int, role: str, db: AsyncSession):
    """Canvas 멤버 추가 (신규 추가 전용 — 역할 변경은 update_role 담당)."""
    # ON CONFLICT DO NOTHING: 동시 중복 추가 경합 시 UNIQUE 위반 500 대신 멱등 처리.
    # 컨트롤러가 is_member로 이미 거르므로, 경합 시 기존 멤버십을 덮어쓰지 않고 그대로 둔다.
    await db.execute(text("""
        INSERT INTO canvas_member (canvas_id, user_id, role)
        VALUES (:canvas_id, :user_id, :role)
        ON CONFLICT (canvas_id, user_id) DO NOTHING
    """), {'canvas_id': canvas_id, 'user_id': user_id, 'role': role})


async def is_member(canvas_id: int, user_id: int, db: AsyncSession) -> bool:
    """사용자가 해당 Canvas의 멤버인지 확인"""
    result = await db.execute(text("""
        SELECT 1 FROM canvas_member
        WHERE canvas_id = :canvas_id AND user_id = :user_id
    """), {'canvas_id': canvas_id, 'user_id': user_id})
    return result.fetchone() is not None


async def find_by_canvas(canvas_id: int, db: AsyncSession):
    """Canvas 멤버 목록"""
    result = await db.execute(text("""
        SELECT cm.user_id, cm.role, cm.joined_at,
               u.username, u.email, u.avatar_url, u.avatar_color
        FROM canvas_member cm
        INNER JOIN "user" u ON cm.user_id = u.user_id
        WHERE cm.canvas_id = :canvas_id
          AND u.deleted_at IS NULL
        ORDER BY cm.joined_at
    """), {'canvas_id': canvas_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def get_role(canvas_id: int, user_id: int, db: AsyncSession):
    """사용자의 Canvas 내 역할 반환"""
    result = await db.execute(text("""
        SELECT role FROM canvas_member
        WHERE canvas_id = :canvas_id AND user_id = :user_id
    """), {'canvas_id': canvas_id, 'user_id': user_id})
    row = result.fetchone()
    return row._mapping['role'] if row else None


async def update_role(canvas_id: int, user_id: int, role: str, db: AsyncSession):
    """멤버 역할 변경"""
    await db.execute(text("""
        UPDATE canvas_member SET role = :role
        WHERE canvas_id = :canvas_id AND user_id = :user_id
    """), {'canvas_id': canvas_id, 'user_id': user_id, 'role': role})


async def remove(canvas_id: int, user_id: int, db: AsyncSession):
    """멤버 제거"""
    await db.execute(text("""
        DELETE FROM canvas_member
        WHERE canvas_id = :canvas_id AND user_id = :user_id
    """), {'canvas_id': canvas_id, 'user_id': user_id})


async def count_admins(canvas_id: int, db: AsyncSession) -> int:
    """Canvas의 admin 수"""
    result = await db.execute(text("""
        SELECT COUNT(*) FROM canvas_member
        WHERE canvas_id = :canvas_id AND role = 'admin'
    """), {'canvas_id': canvas_id})
    return result.scalar_one()


async def search_non_members(canvas_id: int, query: str, db: AsyncSession):
    """초대 가능한 사용자 검색 (아직 멤버가 아닌 active 유저)"""
    result = await db.execute(text("""
        SELECT u.user_id, u.username, u.email, u.avatar_url, u.avatar_color
        FROM "user" u
        WHERE u.status = 'active'
          AND u.deleted_at IS NULL
          AND u.is_system = FALSE
          AND u.user_id NOT IN (
              SELECT user_id FROM canvas_member WHERE canvas_id = :canvas_id
          )
          AND (u.username ILIKE :q OR u.email ILIKE :q)
        ORDER BY u.username
        LIMIT 10
    """), {'canvas_id': canvas_id, 'q': f'%{query}%'})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def search_members(canvas_id: int, query: str, exclude_user_id: int,
                          limit: int = 10, db: AsyncSession = None):
    """Canvas 멤버 중 username 검색 (본인 제외) — @멘션용. 이름·아바타만 반환."""
    result = await db.execute(text("""
        SELECT u.user_id, u.username, u.avatar_url, u.avatar_color
        FROM canvas_member cm
        INNER JOIN "user" u ON cm.user_id = u.user_id
        WHERE cm.canvas_id = :canvas_id
          AND u.user_id != :exclude_user_id
          AND u.status = 'active'
          AND u.deleted_at IS NULL
          AND u.username ILIKE :q
        ORDER BY u.username
        LIMIT :limit
    """), {'canvas_id': canvas_id, 'exclude_user_id': exclude_user_id,
           'q': f'%{query}%', 'limit': limit})
    return [dict(r._mapping) for r in result.fetchall()]
