from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(task_id: int, page_id: int, created_by: int, db: AsyncSession) -> int:
    """태스크-페이지 링크 생성"""
    result = await db.execute(text("""
        INSERT INTO task_page_link (task_id, page_id, created_by)
        VALUES (:task_id, :page_id, :created_by)
        RETURNING link_id
    """), {'task_id': task_id, 'page_id': page_id, 'created_by': created_by})
    return result.scalar_one()


async def find_by_task(task_id: int, db: AsyncSession):
    """태스크에 연결된 캔버스 페이지 목록"""
    result = await db.execute(text("""
        SELECT tpl.link_id, p.page_id, p.canvas_id, p.title,
               c.canvas_name, c.icon AS canvas_icon, c.color AS canvas_color
        FROM task_page_link tpl
        INNER JOIN canvas_page p ON tpl.page_id = p.page_id
        INNER JOIN canvas c ON p.canvas_id = c.canvas_id
        WHERE tpl.task_id = :task_id AND p.is_archived = FALSE
        ORDER BY tpl.created_at
    """), {'task_id': task_id})
    return [dict(row._mapping) for row in result.fetchall()]


async def delete(link_id: int, db: AsyncSession):
    """태스크-페이지 링크 삭제"""
    await db.execute(text("""
        DELETE FROM task_page_link WHERE link_id = :link_id
    """), {'link_id': link_id})


async def search_pages(user_id: int, keyword: str, exclude_task_id: int, db: AsyncSession):
    """페이지 검색 (유저 접근 가능 캔버스만, 이미 연결된 페이지 제외)"""
    result = await db.execute(text("""
        SELECT p.page_id, p.canvas_id, p.title,
               c.canvas_name, c.color AS canvas_color
        FROM canvas_page p
        INNER JOIN canvas c ON p.canvas_id = c.canvas_id
        INNER JOIN canvas_member cm ON c.canvas_id = cm.canvas_id
        WHERE cm.user_id = :user_id
          AND p.is_archived = FALSE
          AND p.title ILIKE :keyword
          AND p.page_id NOT IN (
              SELECT page_id FROM task_page_link WHERE task_id = :exclude_task_id
          )
        ORDER BY p.updated_at DESC
        LIMIT 10
    """), {'user_id': user_id, 'keyword': f'%{keyword}%', 'exclude_task_id': exclude_task_id})
    return [dict(row._mapping) for row in result.fetchall()]
