from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(branch_id: int, label_name: str, color: str, db: AsyncSession) -> int:
    """Label 생성"""
    result = await db.execute(text("""
        INSERT INTO label (branch_id, label_name, color)
        VALUES (:branch_id, :label_name, :color)
        RETURNING label_id
    """), {
        'branch_id': branch_id,
        'label_name': label_name,
        'color': color,
    })
    return result.scalar_one()


async def find_by_branch(branch_id: int, db: AsyncSession):
    """Branch의 Label 목록"""
    result = await db.execute(text("""
        SELECT label_id, label_name, color, created_at
        FROM label
        WHERE branch_id = :branch_id
        ORDER BY label_name
    """), {'branch_id': branch_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def find_by_id(label_id: int, db: AsyncSession):
    """Label 상세 조회"""
    result = await db.execute(text("""
        SELECT label_id, branch_id, label_name, color
        FROM label
        WHERE label_id = :label_id
    """), {'label_id': label_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def update(label_id: int, label_name: str, color: str, db: AsyncSession):
    """Label 수정"""
    await db.execute(text("""
        UPDATE label SET label_name = :label_name, color = :color
        WHERE label_id = :label_id
    """), {'label_id': label_id, 'label_name': label_name, 'color': color})


async def delete(label_id: int, db: AsyncSession):
    """Label 삭제 (task_label도 CASCADE 삭제)"""
    await db.execute(text("""
        DELETE FROM label WHERE label_id = :label_id
    """), {'label_id': label_id})
