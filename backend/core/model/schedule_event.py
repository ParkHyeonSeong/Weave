from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(branch_id: int, title: str, description: str,
                 start_date, end_date, color: str, created_by: int,
                 db: AsyncSession) -> int:
    """Schedule event 생성"""
    result = await db.execute(text("""
        INSERT INTO schedule_event (branch_id, title, description, start_date, end_date, color, created_by)
        VALUES (:branch_id, :title, :description, :start_date, :end_date, :color, :created_by)
        RETURNING schedule_event_id
    """), {
        'branch_id': branch_id,
        'title': title,
        'description': description,
        'start_date': start_date,
        'end_date': end_date,
        'color': color,
        'created_by': created_by,
    })
    await db.commit()
    return result.scalar_one()


async def find_by_id(schedule_event_id: int, db: AsyncSession):
    """Schedule event 상세 조회"""
    result = await db.execute(text("""
        SELECT se.schedule_event_id, se.branch_id, se.title, se.description,
               se.start_date, se.end_date, se.color, se.created_by, se.created_at,
               u.display_name AS created_by_name
        FROM schedule_event se
        JOIN "user" u ON se.created_by = u.user_id
        WHERE se.schedule_event_id = :schedule_event_id
    """), {'schedule_event_id': schedule_event_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_by_branch_and_range(branch_id: int, range_start, range_end,
                                   db: AsyncSession):
    """Branch의 날짜 범위에 걸치는 schedule event 목록"""
    result = await db.execute(text("""
        SELECT se.schedule_event_id, se.title, se.description,
               se.start_date, se.end_date, se.color, se.created_by, se.created_at,
               u.display_name AS created_by_name
        FROM schedule_event se
        JOIN "user" u ON se.created_by = u.user_id
        WHERE se.branch_id = :branch_id
          AND se.start_date <= :range_end
          AND (se.end_date >= :range_start OR (se.end_date IS NULL AND se.start_date >= :range_start))
        ORDER BY se.start_date, se.created_at
    """), {
        'branch_id': branch_id,
        'range_start': range_start,
        'range_end': range_end,
    })
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def update(schedule_event_id: int, fields: dict, db: AsyncSession):
    """Schedule event 수정 (동적 필드)"""
    allowed = {'title', 'description', 'start_date', 'end_date', 'color'}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return

    set_clause = ', '.join(f'{k} = :{k}' for k in updates)
    updates['schedule_event_id'] = schedule_event_id
    await db.execute(text(f"""
        UPDATE schedule_event SET {set_clause} WHERE schedule_event_id = :schedule_event_id
    """), updates)
    await db.commit()


async def delete(schedule_event_id: int, db: AsyncSession):
    """Schedule event 삭제"""
    await db.execute(text("""
        DELETE FROM schedule_event WHERE schedule_event_id = :schedule_event_id
    """), {'schedule_event_id': schedule_event_id})
    await db.commit()
