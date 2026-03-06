from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(canvas_name: str, key: str, description: str,
                 visibility: str, created_by: int, branch_id: int, db: AsyncSession) -> int:
    """Canvas 생성"""
    result = await db.execute(text("""
        INSERT INTO canvas (canvas_name, key, description, visibility, created_by, branch_id)
        VALUES (:canvas_name, :key, :description, :visibility, :created_by, :branch_id)
        RETURNING canvas_id
    """), {
        'canvas_name': canvas_name,
        'key': key,
        'description': description,
        'visibility': visibility,
        'created_by': created_by,
        'branch_id': branch_id,
    })
    await db.commit()
    return result.scalar_one()


async def find_by_id(canvas_id: int, db: AsyncSession):
    """Canvas 상세 조회"""
    result = await db.execute(text("""
        SELECT c.canvas_id, c.canvas_name, c.key, c.description,
               c.icon, c.color, c.visibility, c.is_archived,
               c.branch_id, c.created_by, c.created_at, c.updated_at
        FROM canvas c
        WHERE c.canvas_id = :canvas_id AND c.is_archived = FALSE
    """), {'canvas_id': canvas_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_accessible(user_id: int, db: AsyncSession):
    """사용자가 접근 가능한 Canvas 목록"""
    result = await db.execute(text("""
        SELECT c.canvas_id, c.canvas_name, c.key, c.description,
               c.icon, c.color, c.visibility, c.branch_id, c.created_at,
               cm.role AS my_role
        FROM canvas c
        INNER JOIN canvas_member cm ON c.canvas_id = cm.canvas_id
        WHERE cm.user_id = :user_id AND c.is_archived = FALSE
        ORDER BY c.canvas_name
    """), {'user_id': user_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def update(canvas_id: int, fields: dict, db: AsyncSession):
    """Canvas 정보 수정"""
    set_clauses = ', '.join(f'{k} = :{k}' for k in fields)
    params = {**fields, 'canvas_id': canvas_id}
    await db.execute(text(f"""
        UPDATE canvas SET {set_clauses}, updated_at = NOW()
        WHERE canvas_id = :canvas_id
    """), params)
    await db.commit()


async def find_by_key(key: str, db: AsyncSession):
    """key로 Canvas 조회 (중복 체크용)"""
    result = await db.execute(text("""
        SELECT canvas_id FROM canvas WHERE key = :key
    """), {'key': key})
    return result.fetchone() is not None


async def archive(canvas_id: int, db: AsyncSession):
    """Canvas 아카이브 (soft delete)"""
    await db.execute(text("""
        UPDATE canvas SET is_archived = TRUE, updated_at = NOW()
        WHERE canvas_id = :canvas_id
    """), {'canvas_id': canvas_id})
    await db.commit()


async def find_public(user_id: int, query: str, db: AsyncSession):
    """public Canvas 목록 (가입 여부 포함)"""
    params = {'user_id': user_id}
    where_search = ''
    if query:
        where_search = "AND (c.canvas_name ILIKE :q OR c.key ILIKE :q)"
        params['q'] = f'%{query}%'

    result = await db.execute(text(f"""
        SELECT c.canvas_id, c.canvas_name, c.key, c.description,
               c.color, c.created_at,
               (SELECT COUNT(*) FROM canvas_member cm2
                WHERE cm2.canvas_id = c.canvas_id) AS member_count,
               EXISTS(
                   SELECT 1 FROM canvas_member cm3
                   WHERE cm3.canvas_id = c.canvas_id AND cm3.user_id = :user_id
               ) AS is_member
        FROM canvas c
        WHERE c.visibility = 'public'
          AND c.is_archived = FALSE
          {where_search}
        ORDER BY c.canvas_name
    """), params)
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]
