from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(branch_id: int, epic_name: str, description: str,
                 status: str, color: str, start_date, due_date,
                 created_by: int, db: AsyncSession) -> int:
    """Epic 생성"""
    result = await db.execute(text("""
        INSERT INTO epic (branch_id, epic_name, description, status, color,
                          start_date, due_date, created_by)
        VALUES (:branch_id, :epic_name, :description, :status, :color,
                :start_date, :due_date, :created_by)
        RETURNING epic_id
    """), {
        'branch_id': branch_id,
        'epic_name': epic_name,
        'description': description,
        'status': status,
        'color': color,
        'start_date': start_date,
        'due_date': due_date,
        'created_by': created_by,
    })
    await db.commit()
    return result.scalar_one()


async def find_by_id(epic_id: int, db: AsyncSession):
    """Epic 상세 조회"""
    result = await db.execute(text("""
        SELECT epic_id, branch_id, epic_name, description,
               status, color, start_date, due_date, sort_order,
               created_by, created_at, updated_at
        FROM epic
        WHERE epic_id = :epic_id
    """), {'epic_id': epic_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_by_branch(branch_id: int, db: AsyncSession):
    """Branch의 Epic 목록 (task count 포함)"""
    result = await db.execute(text("""
        SELECT e.epic_id, e.epic_name, e.description,
               e.status, e.color, e.start_date, e.due_date,
               e.sort_order, e.created_at,
               COUNT(t.task_id) AS task_count
        FROM epic e
        LEFT JOIN task t ON e.epic_id = t.epic_id
        WHERE e.branch_id = :branch_id
        GROUP BY e.epic_id
        ORDER BY e.sort_order, e.created_at
    """), {'branch_id': branch_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def update(epic_id: int, fields: dict, db: AsyncSession):
    """Epic 수정 (동적 필드)"""
    allowed = {'epic_name', 'description', 'status', 'color', 'start_date', 'due_date', 'sort_order'}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return

    updates['updated_at'] = text('NOW()')
    set_parts = []
    params = {'epic_id': epic_id}
    for k, v in updates.items():
        if isinstance(v, type(text(''))):
            set_parts.append(f'{k} = NOW()')
        else:
            set_parts.append(f'{k} = :{k}')
            params[k] = v

    set_clause = ', '.join(set_parts)
    await db.execute(text(f"""
        UPDATE epic SET {set_clause} WHERE epic_id = :epic_id
    """), params)
    await db.commit()


async def reorder(branch_id: int, epic_ids: list, db: AsyncSession):
    """Epic 순서 일괄 변경"""
    for idx, eid in enumerate(epic_ids):
        await db.execute(text("""
            UPDATE epic SET sort_order = :sort_order
            WHERE epic_id = :epic_id AND branch_id = :branch_id
        """), {'sort_order': idx, 'epic_id': eid, 'branch_id': branch_id})
    await db.commit()


async def delete(epic_id: int, db: AsyncSession):
    """Epic 삭제 (task들의 epic_id = NULL로)"""
    await db.execute(text("""
        UPDATE task SET epic_id = NULL WHERE epic_id = :epic_id
    """), {'epic_id': epic_id})
    await db.execute(text("""
        DELETE FROM epic WHERE epic_id = :epic_id
    """), {'epic_id': epic_id})
    await db.commit()
