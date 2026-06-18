from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create_issue(task_id: int, title: str, body: str, created_by: int, db: AsyncSession) -> int:
    """이슈 생성"""
    result = await db.execute(text("""
        INSERT INTO task_issue (task_id, title, body, created_by)
        VALUES (:task_id, :title, :body, :created_by)
        RETURNING issue_id
    """), {'task_id': task_id, 'title': title, 'body': body, 'created_by': created_by})
    return result.scalar_one()


async def find_by_task(task_id: int, db: AsyncSession):
    """Task의 이슈 목록"""
    result = await db.execute(text("""
        SELECT i.issue_id, i.title, i.status, i.created_by, i.created_at,
               u.username AS author_name,
               u.avatar_url AS author_avatar_url, u.avatar_color AS author_avatar_color,
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
               u.username AS author_name,
               u.avatar_url AS author_avatar_url, u.avatar_color AS author_avatar_color
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


async def delete_issue(issue_id: int, db: AsyncSession):
    """이슈 삭제 (댓글도 CASCADE 삭제)"""
    await db.execute(text("""
        DELETE FROM task_issue WHERE issue_id = :issue_id
    """), {'issue_id': issue_id})


async def find_by_id_simple(issue_id: int, db: AsyncSession):
    """이슈 간단 조회 (채팅 issue_ref 용)"""
    result = await db.execute(text("""
        SELECT i.issue_id, i.task_id, i.title, i.status,
               t.branch_id, t.display_number,
               b.key AS branch_key
        FROM task_issue i
        INNER JOIN task t ON i.task_id = t.task_id
        INNER JOIN branch b ON t.branch_id = b.branch_id
        WHERE i.issue_id = :issue_id
          AND b.is_archived = FALSE
    """), {'issue_id': issue_id})
    row = result.fetchone()
    if not row:
        return None
    d = dict(row._mapping)
    d['display_id'] = f"{d['branch_key']}-{d['display_number']}"
    return d


async def search_for_chat(user_id: int, keyword: str, db: AsyncSession):
    """채팅용 이슈 검색 (유저가 속한 branch의 이슈만). 제목·본문·부모 task ID 매칭."""
    keyword_like = f'%{keyword}%' if keyword else '%'
    result = await db.execute(text("""
        SELECT i.issue_id, i.task_id, i.title, i.status,
               t.display_number, t.title AS task_title,
               t.branch_id, b.key AS branch_key,
               CASE
                   -- (b.key || '-' || display_number) = 'KEY-123' 사용자 노출 task ID
                   WHEN (b.key || '-' || t.display_number::text) ILIKE :keyword THEN 0
                   WHEN i.title ILIKE :keyword THEN 1
                   ELSE 2
               END AS _rank
        FROM task_issue i
        INNER JOIN task t ON i.task_id = t.task_id
        INNER JOIN branch b ON t.branch_id = b.branch_id
        INNER JOIN branch_member bm ON b.branch_id = bm.branch_id
        WHERE bm.user_id = :user_id
          AND b.is_archived = FALSE
          AND (
              i.title ILIKE :keyword
              OR i.body ILIKE :keyword
              OR (b.key || '-' || t.display_number::text) ILIKE :keyword
          )
        ORDER BY _rank, i.created_at DESC
        LIMIT 10
    """), {'user_id': user_id, 'keyword': keyword_like})
    rows = result.fetchall()
    results = []
    for row in rows:
        d = dict(row._mapping)
        d.pop('_rank', None)
        d['display_id'] = f"{d['branch_key']}-{d['display_number']}"
        results.append(d)
    return results


async def batch_statuses(issue_ids: list[int], user_id: int, db: AsyncSession) -> dict:
    """Ref 상태 배치 조회 (issue_id → status/title), 멤버인 branch만"""
    if not issue_ids:
        return {}
    result = await db.execute(text("""
        SELECT ti.issue_id, ti.status, ti.title
        FROM task_issue ti
        INNER JOIN task t ON t.task_id = ti.task_id
        INNER JOIN branch b ON b.branch_id = t.branch_id
        INNER JOIN branch_member bm ON bm.branch_id = t.branch_id AND bm.user_id = :user_id
        WHERE ti.issue_id = ANY(:ids)
          AND b.is_archived = FALSE
    """), {'ids': issue_ids, 'user_id': user_id})
    return {str(r.issue_id): {'status': r.status, 'title': r.title} for r in result.fetchall()}


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
    return result.scalar_one()


async def find_comments(issue_id: int, db: AsyncSession):
    """이슈의 댓글 목록"""
    result = await db.execute(text("""
        SELECT c.comment_id, c.issue_id, c.author_id, c.content,
               c.created_at, c.updated_at,
               u.username AS author_name,
               u.avatar_url AS author_avatar_url, u.avatar_color AS author_avatar_color
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


async def find_commenter_ids(issue_id: int, db: AsyncSession) -> list[int]:
    """이슈의 고유 코멘터 user_id 목록"""
    result = await db.execute(text("""
        SELECT DISTINCT author_id FROM task_issue_comment
        WHERE issue_id = :issue_id
    """), {'issue_id': issue_id})
    return [r[0] for r in result.fetchall()]


async def delete_comment(comment_id: int, db: AsyncSession):
    """댓글 삭제"""
    await db.execute(text("""
        DELETE FROM task_issue_comment WHERE comment_id = :comment_id
    """), {'comment_id': comment_id})
