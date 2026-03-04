from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(branch_name: str, slug: str, description: str,
                 visibility: str, created_by: int, db: AsyncSession) -> int:
    """Branch 생성"""
    result = await db.execute(text("""
        INSERT INTO branch (branch_name, slug, description, visibility, created_by)
        VALUES (:branch_name, :slug, :description, :visibility, :created_by)
        RETURNING branch_id
    """), {
        'branch_name': branch_name,
        'slug': slug,
        'description': description,
        'visibility': visibility,
        'created_by': created_by,
    })
    await db.commit()
    return result.scalar_one()


async def find_by_id(branch_id: int, db: AsyncSession):
    """Branch 상세 조회"""
    result = await db.execute(text("""
        SELECT b.branch_id, b.branch_name, b.slug, b.description,
               b.icon, b.color, b.visibility, b.is_archived,
               b.created_by, b.created_at, b.updated_at
        FROM branch b
        WHERE b.branch_id = :branch_id AND b.is_archived = FALSE
    """), {'branch_id': branch_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_accessible(user_id: int, db: AsyncSession):
    """사용자가 접근 가능한 Branch 목록"""
    result = await db.execute(text("""
        SELECT b.branch_id, b.branch_name, b.slug, b.description,
               b.icon, b.color, b.visibility, b.created_at,
               bm.role AS my_role
        FROM branch b
        INNER JOIN branch_member bm ON b.branch_id = bm.branch_id
        WHERE bm.user_id = :user_id AND b.is_archived = FALSE
        ORDER BY b.branch_name
    """), {'user_id': user_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def find_by_slug(slug: str, db: AsyncSession):
    """slug로 Branch 조회 (중복 체크용)"""
    result = await db.execute(text("""
        SELECT branch_id FROM branch WHERE slug = :slug
    """), {'slug': slug})
    return result.fetchone() is not None
