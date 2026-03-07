from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(branch_id: int, sprint_name: str, goal: str,
                 start_date, end_date, created_by: int, db: AsyncSession) -> int:
    """Sprint 생성"""
    result = await db.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, goal, start_date, end_date, created_by)
        VALUES (:branch_id, :sprint_name, :goal, :start_date, :end_date, :created_by)
        RETURNING sprint_id
    """), {
        'branch_id': branch_id,
        'sprint_name': sprint_name,
        'goal': goal,
        'start_date': start_date,
        'end_date': end_date,
        'created_by': created_by,
    })
    await db.commit()
    return result.scalar_one()


async def find_by_id(sprint_id: int, db: AsyncSession):
    """Sprint 상세 조회"""
    result = await db.execute(text("""
        SELECT sprint_id, branch_id, sprint_name, goal,
               start_date, end_date, status, sort_order,
               created_by, created_at
        FROM sprint
        WHERE sprint_id = :sprint_id
    """), {'sprint_id': sprint_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_by_branch(branch_id: int, db: AsyncSession):
    """Branch의 Sprint 목록 (sort_order 순)"""
    result = await db.execute(text("""
        SELECT s.sprint_id, s.sprint_name, s.goal,
               s.start_date, s.end_date, s.status, s.sort_order,
               s.created_at,
               COUNT(t.task_id) AS task_count
        FROM sprint s
        LEFT JOIN task t ON s.sprint_id = t.sprint_id
        WHERE s.branch_id = :branch_id
        GROUP BY s.sprint_id
        ORDER BY s.sort_order, s.created_at
    """), {'branch_id': branch_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def find_active_sprints(branch_id: int, db: AsyncSession):
    """Branch의 active Sprint 목록 조회"""
    result = await db.execute(text("""
        SELECT sprint_id, sprint_name, start_date, end_date
        FROM sprint
        WHERE branch_id = :branch_id AND status = 'active'
        ORDER BY sort_order, created_at
    """), {'branch_id': branch_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def update(sprint_id: int, fields: dict, db: AsyncSession):
    """Sprint 수정 (동적 필드)"""
    allowed = {'sprint_name', 'goal', 'start_date', 'end_date', 'status', 'sort_order'}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return

    set_clause = ', '.join(f'{k} = :{k}' for k in updates)
    updates['sprint_id'] = sprint_id
    await db.execute(text(f"""
        UPDATE sprint SET {set_clause} WHERE sprint_id = :sprint_id
    """), updates)
    await db.commit()


async def reorder(branch_id: int, sprint_ids: list, db: AsyncSession):
    """Sprint 순서 일괄 변경"""
    for idx, sid in enumerate(sprint_ids):
        await db.execute(text("""
            UPDATE sprint SET sort_order = :sort_order
            WHERE sprint_id = :sprint_id AND branch_id = :branch_id
        """), {'sort_order': idx, 'sprint_id': sid, 'branch_id': branch_id})
    await db.commit()


async def delete(sprint_id: int, db: AsyncSession):
    """Sprint 삭제 (task들은 sprint_id = NULL로)"""
    await db.execute(text("""
        UPDATE task SET sprint_id = NULL WHERE sprint_id = :sprint_id
    """), {'sprint_id': sprint_id})
    await db.execute(text("""
        DELETE FROM sprint WHERE sprint_id = :sprint_id
    """), {'sprint_id': sprint_id})
    await db.commit()
