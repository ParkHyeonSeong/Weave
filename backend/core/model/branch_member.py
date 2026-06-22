from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def add(branch_id: int, user_id: int, role: str, db: AsyncSession):
    """Branch 멤버 추가 (신규 추가 전용 — 역할 변경은 update_role 담당)."""
    # ON CONFLICT DO NOTHING: 동시 중복 추가 경합 시 UNIQUE 위반 500 대신 멱등 처리.
    # 컨트롤러가 is_member로 이미 거르므로, 경합 시 기존 멤버십을 덮어쓰지 않고 그대로 둔다.
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:branch_id, :user_id, :role)
        ON CONFLICT (branch_id, user_id) DO NOTHING
    """), {'branch_id': branch_id, 'user_id': user_id, 'role': role})


async def is_member(branch_id: int, user_id: int, db: AsyncSession) -> bool:
    """사용자가 해당 Branch의 멤버인지 확인"""
    result = await db.execute(text("""
        SELECT 1 FROM branch_member
        WHERE branch_id = :branch_id AND user_id = :user_id
    """), {'branch_id': branch_id, 'user_id': user_id})
    return result.fetchone() is not None


async def filter_member_branch_ids(user_id: int, branch_ids,
                                    db: AsyncSession) -> set:
    """주어진 branch_ids 중 사용자가 멤버인 것만 추려 반환 (단일 쿼리)"""
    ids = list(branch_ids or [])
    if not ids:
        return set()
    result = await db.execute(text("""
        SELECT branch_id FROM branch_member
        WHERE user_id = :user_id AND branch_id = ANY(:ids)
    """), {'user_id': user_id, 'ids': ids})
    return {r[0] for r in result.fetchall()}


async def member_branch_ids(user_id: int, db: AsyncSession) -> set:
    """사용자가 멤버인 (비아카이브) branch_id 집합."""
    result = await db.execute(text("""
        SELECT bm.branch_id FROM branch_member bm
        INNER JOIN branch b ON b.branch_id = bm.branch_id
        WHERE bm.user_id = :user_id AND b.is_archived = FALSE
    """), {'user_id': user_id})
    return {r[0] for r in result.fetchall()}


async def find_by_branch(branch_id: int, db: AsyncSession):
    """Branch 멤버 목록"""
    result = await db.execute(text("""
        SELECT bm.user_id, bm.role, bm.joined_at,
               u.username, u.email, u.avatar_url, u.avatar_color
        FROM branch_member bm
        INNER JOIN "user" u ON bm.user_id = u.user_id
        WHERE bm.branch_id = :branch_id
          AND u.deleted_at IS NULL
        ORDER BY bm.joined_at
    """), {'branch_id': branch_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def get_role(branch_id: int, user_id: int, db: AsyncSession):
    """사용자의 Branch 내 역할 반환"""
    result = await db.execute(text("""
        SELECT role FROM branch_member
        WHERE branch_id = :branch_id AND user_id = :user_id
    """), {'branch_id': branch_id, 'user_id': user_id})
    row = result.fetchone()
    return row._mapping['role'] if row else None


async def update_role(branch_id: int, user_id: int, role: str, db: AsyncSession):
    """멤버 역할 변경"""
    await db.execute(text("""
        UPDATE branch_member SET role = :role
        WHERE branch_id = :branch_id AND user_id = :user_id
    """), {'branch_id': branch_id, 'user_id': user_id, 'role': role})


async def remove(branch_id: int, user_id: int, db: AsyncSession):
    """멤버 제거"""
    await db.execute(text("""
        DELETE FROM branch_member
        WHERE branch_id = :branch_id AND user_id = :user_id
    """), {'branch_id': branch_id, 'user_id': user_id})


async def count_admins(branch_id: int, db: AsyncSession) -> int:
    """Branch의 admin 수"""
    result = await db.execute(text("""
        SELECT COUNT(*) FROM branch_member
        WHERE branch_id = :branch_id AND role = 'admin'
    """), {'branch_id': branch_id})
    return result.scalar_one()


async def search_members(branch_id: int, query: str, exclude_user_id: int,
                          limit: int = 10, db: AsyncSession = None):
    """Branch 멤버 중 username 검색 (본인 제외) — @멘션용. 이름·아바타만, 활성·비삭제 멤버만."""
    result = await db.execute(text("""
        SELECT u.user_id, u.username, u.avatar_url, u.avatar_color
        FROM branch_member bm
        INNER JOIN "user" u ON bm.user_id = u.user_id
        WHERE bm.branch_id = :branch_id
          AND u.user_id != :exclude_user_id
          AND u.status = 'active'
          AND u.deleted_at IS NULL
          AND u.username ILIKE :q
        ORDER BY u.username
        LIMIT :limit
    """), {'branch_id': branch_id, 'exclude_user_id': exclude_user_id,
           'q': f'%{query}%', 'limit': limit})
    return [dict(r._mapping) for r in result.fetchall()]


async def filter_users_in_branch(branch_id: int, user_ids: list[int],
                                  db: AsyncSession) -> list[int]:
    """주어진 user_ids 중 해당 branch의 멤버만 추려서 반환 (없으면 빈 리스트)."""
    if not user_ids:
        return []
    result = await db.execute(text("""
        SELECT user_id FROM branch_member
        WHERE branch_id = :branch_id
          AND user_id = ANY(CAST(:user_ids AS bigint[]))
    """), {'branch_id': branch_id, 'user_ids': list(set(user_ids))})
    return [row[0] for row in result.fetchall()]


async def search_non_members(branch_id: int, query: str, db: AsyncSession):
    """초대 가능한 사용자 검색 (아직 멤버가 아닌 active 유저)"""
    result = await db.execute(text("""
        SELECT u.user_id, u.username, u.email, u.avatar_url, u.avatar_color
        FROM "user" u
        WHERE u.status = 'active'
          AND u.deleted_at IS NULL
          AND u.user_id NOT IN (
              SELECT user_id FROM branch_member WHERE branch_id = :branch_id
          )
          AND (u.username ILIKE :q OR u.email ILIKE :q)
        ORDER BY u.username
        LIMIT 10
    """), {'branch_id': branch_id, 'q': f'%{query}%'})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]
