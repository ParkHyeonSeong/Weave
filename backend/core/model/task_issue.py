from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create_issue(task_id: int, title: str, body: str, created_by: int, db: AsyncSession) -> int:
    """이슈 생성"""
    result = await db.execute(text("""
        INSERT INTO task_issue (task_id, title, body, created_by)
        VALUES (:task_id, :title, :body, :created_by)
        RETURNING issue_id
    """), {'task_id': task_id, 'title': title, 'body': body, 'created_by': created_by})
    await db.commit()
    return result.scalar_one()


async def find_by_task(task_id: int, db: AsyncSession):
    """Task의 이슈 목록"""
    result = await db.execute(text("""
        SELECT i.issue_id, i.title, i.status, i.created_by, i.created_at,
               u.username AS author_name,
               (SELECT COUNT(*) FROM task_issue_comment c WHERE c.issue_id = i.issue_id) AS comment_count
        FROM task_issue i
        INNER JOIN "user" u ON i.created_by = u.user_id
        WHERE i.task_id = :task_id
        ORDER BY i.created_at DESC
    """), {'task_id': task_id})
    return [dict(r._mapping) for r in result.fetchall()]


async def find_by_id(issue_id: int, db: AsyncSession):
    """이슈 상세"""
    result = await db.execute(text("""
        SELECT i.issue_id, i.task_id, i.title, i.body, i.status,
               i.created_by, i.created_at, i.updated_at,
               u.username AS author_name
        FROM task_issue i
        INNER JOIN "user" u ON i.created_by = u.user_id
        WHERE i.issue_id = :issue_id
    """), {'issue_id': issue_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def update_issue(issue_id: int, fields: dict, db: AsyncSession):
    """이슈 수정 (title/body/status)"""
    allowed = {'title', 'body', 'status'}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    set_parts = [f'{k} = :{k}' for k in updates]
    set_parts.append('updated_at = NOW()')
    updates['issue_id'] = issue_id
    await db.execute(text(f"""
        UPDATE task_issue SET {', '.join(set_parts)} WHERE issue_id = :issue_id
    """), updates)
    await db.commit()


async def delete_issue(issue_id: int, db: AsyncSession):
    """이슈 삭제 (댓글도 CASCADE 삭제)"""
    await db.execute(text("""
        DELETE FROM task_issue WHERE issue_id = :issue_id
    """), {'issue_id': issue_id})
    await db.commit()


async def get_task_id(issue_id: int, db: AsyncSession):
    """이슈의 task_id 조회"""
    result = await db.execute(text("""
        SELECT task_id FROM task_issue WHERE issue_id = :issue_id
    """), {'issue_id': issue_id})
    row = result.fetchone()
    return row[0] if row else None


# -- 댓글 --

async def create_comment(issue_id: int, author_id: int, content: str, db: AsyncSession) -> int:
    """댓글 생성"""
    result = await db.execute(text("""
        INSERT INTO task_issue_comment (issue_id, author_id, content)
        VALUES (:issue_id, :author_id, :content)
        RETURNING comment_id
    """), {'issue_id': issue_id, 'author_id': author_id, 'content': content})
    await db.commit()
    return result.scalar_one()


async def find_comments(issue_id: int, db: AsyncSession):
    """이슈의 댓글 목록"""
    result = await db.execute(text("""
        SELECT c.comment_id, c.issue_id, c.author_id, c.content,
               c.created_at, c.updated_at,
               u.username AS author_name
        FROM task_issue_comment c
        INNER JOIN "user" u ON c.author_id = u.user_id
        WHERE c.issue_id = :issue_id
        ORDER BY c.created_at ASC
    """), {'issue_id': issue_id})
    return [dict(r._mapping) for r in result.fetchall()]


async def find_comment_by_id(comment_id: int, db: AsyncSession):
    """댓글 상세"""
    result = await db.execute(text("""
        SELECT comment_id, issue_id, author_id, content, created_at, updated_at
        FROM task_issue_comment
        WHERE comment_id = :comment_id
    """), {'comment_id': comment_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def update_comment(comment_id: int, content: str, db: AsyncSession):
    """댓글 수정"""
    await db.execute(text("""
        UPDATE task_issue_comment SET content = :content, updated_at = NOW()
        WHERE comment_id = :comment_id
    """), {'comment_id': comment_id, 'content': content})
    await db.commit()


async def delete_comment(comment_id: int, db: AsyncSession):
    """댓글 삭제"""
    await db.execute(text("""
        DELETE FROM task_issue_comment WHERE comment_id = :comment_id
    """), {'comment_id': comment_id})
    await db.commit()
