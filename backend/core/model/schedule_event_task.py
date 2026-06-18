from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(schedule_event_id: int, task_id: int, created_by: int, db: AsyncSession) -> int:
    """이벤트-태스크 링크 생성"""
    result = await db.execute(text("""
        INSERT INTO schedule_event_task (schedule_event_id, task_id, created_by)
        VALUES (:schedule_event_id, :task_id, :created_by)
        RETURNING link_id
    """), {'schedule_event_id': schedule_event_id, 'task_id': task_id, 'created_by': created_by})
    return result.scalar_one()


async def find_by_event(schedule_event_id: int, db: AsyncSession):
    """이벤트에 연결된 태스크 목록"""
    result = await db.execute(text("""
        SELECT st.link_id, t.task_id, t.display_number, t.title,
               t.status, t.priority, b.key AS branch_key,
               ws.label AS status_label, ws.color AS status_color, ws.category AS status_category
        FROM schedule_event_task st
        INNER JOIN task t ON st.task_id = t.task_id
        INNER JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN workflow_status ws ON ws.branch_id = t.branch_id AND ws.key = t.status
        WHERE st.schedule_event_id = :schedule_event_id
          AND b.is_archived = FALSE
        ORDER BY st.created_at
    """), {'schedule_event_id': schedule_event_id})
    rows = result.fetchall()
    tasks = []
    for row in rows:
        task = dict(row._mapping)
        task['display_id'] = f"{task['branch_key']}-{task['display_number']}"
        tasks.append(task)
    return tasks


async def delete(link_id: int, db: AsyncSession):
    """이벤트-태스크 링크 삭제"""
    await db.execute(text("""
        DELETE FROM schedule_event_task WHERE link_id = :link_id
    """), {'link_id': link_id})


async def search_tasks(branch_id: int, keyword: str, exclude_event_id: int, db: AsyncSession):
    """연결 가능한 태스크 검색 (이미 연결된 태스크 제외)"""
    result = await db.execute(text("""
        SELECT t.task_id, t.display_number, t.title,
               t.status, t.priority, b.key AS branch_key,
               ws.label AS status_label, ws.color AS status_color, ws.category AS status_category
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN workflow_status ws ON ws.branch_id = t.branch_id AND ws.key = t.status
        WHERE t.branch_id = :branch_id
          AND b.is_archived = FALSE
          AND t.title ILIKE :keyword
          AND t.task_id NOT IN (
              SELECT task_id FROM schedule_event_task WHERE schedule_event_id = :exclude_event_id
          )
        ORDER BY t.updated_at DESC NULLS LAST
        LIMIT 10
    """), {'branch_id': branch_id, 'keyword': f'%{keyword}%', 'exclude_event_id': exclude_event_id})
    rows = result.fetchall()
    tasks = []
    for row in rows:
        task = dict(row._mapping)
        task['display_id'] = f"{task['branch_key']}-{task['display_number']}"
        tasks.append(task)
    return tasks
