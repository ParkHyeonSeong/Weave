from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(branch_name: str, key: str, description: str,
                 visibility: str, created_by: int, db: AsyncSession) -> int:
    """Branch 생성"""
    result = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, created_by)
        VALUES (:branch_name, :key, :description, :visibility, :created_by)
        RETURNING branch_id
    """), {
        'branch_name': branch_name,
        'key': key,
        'description': description,
        'visibility': visibility,
        'created_by': created_by,
    })
    return result.scalar_one()


async def find_by_id(branch_id: int, db: AsyncSession):
    """Branch 상세 조회"""
    result = await db.execute(text("""
        SELECT b.branch_id, b.branch_name, b.key, b.description,
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
        SELECT b.branch_id, b.branch_name, b.key, b.description,
               b.icon, b.color, b.visibility, b.created_at,
               bm.role AS my_role
        FROM branch b
        INNER JOIN branch_member bm ON b.branch_id = bm.branch_id
        WHERE bm.user_id = :user_id AND b.is_archived = FALSE
        ORDER BY b.branch_name
    """), {'user_id': user_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def update(branch_id: int, fields: dict, db: AsyncSession):
    """Branch 정보 수정"""
    set_clauses = ', '.join(f'{k} = :{k}' for k in fields)
    params = {**fields, 'branch_id': branch_id}
    await db.execute(text(f"""
        UPDATE branch SET {set_clauses}, updated_at = NOW()
        WHERE branch_id = :branch_id
    """), params)


async def find_by_key(key: str, db: AsyncSession):
    """key로 Branch 조회 (중복 체크용)"""
    result = await db.execute(text("""
        SELECT branch_id FROM branch WHERE key = :key
    """), {'key': key})
    return result.fetchone() is not None


async def archive(branch_id: int, db: AsyncSession):
    """Branch 아카이브 (soft delete)"""
    await db.execute(text("""
        UPDATE branch SET is_archived = TRUE, updated_at = NOW()
        WHERE branch_id = :branch_id
    """), {'branch_id': branch_id})


async def find_public(user_id: int, query: str, db: AsyncSession):
    """public Branch 목록 (가입 여부 포함)"""
    params = {'user_id': user_id}
    where_search = ''
    if query:
        where_search = "AND (b.branch_name ILIKE :q OR b.key ILIKE :q)"
        params['q'] = f'%{query}%'

    result = await db.execute(text(f"""
        SELECT b.branch_id, b.branch_name, b.key, b.description,
               b.color, b.created_at,
               (SELECT COUNT(*) FROM branch_member bm2
                WHERE bm2.branch_id = b.branch_id) AS member_count,
               EXISTS(
                   SELECT 1 FROM branch_member bm3
                   WHERE bm3.branch_id = b.branch_id AND bm3.user_id = :user_id
               ) AS is_member
        FROM branch b
        WHERE b.visibility = 'public'
          AND b.is_archived = FALSE
          {where_search}
        ORDER BY b.branch_name
    """), params)
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]
