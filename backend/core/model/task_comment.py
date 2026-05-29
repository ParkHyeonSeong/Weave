from typing import Optional
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# ---- Create ----

async def create(task_id: int, author_id: int, content: str,
                 parent_comment_id: Optional[int], db: AsyncSession) -> int:
    """댓글 생성"""
    result = await db.execute(text("""
        INSERT INTO task_comment (task_id, author_id, content, parent_comment_id)
        VALUES (:task_id, :author_id, :content, :parent_comment_id)
        RETURNING comment_id
    """), {
        'task_id': task_id,
        'author_id': author_id,
        'content': content,
        'parent_comment_id': parent_comment_id,
    })
    return result.scalar_one()


# ---- Read ----

async def find_by_id(comment_id: int, db: AsyncSession):
    """단일 댓글 (soft-deleted 포함)"""
    result = await db.execute(text("""
        SELECT c.comment_id, c.task_id, c.parent_comment_id, c.author_id,
               c.content, c.is_edited,
               c.created_at, c.updated_at, c.deleted_at,
               u.username, u.avatar_url
        FROM task_comment c
        INNER JOIN "user" u ON c.author_id = u.user_id
        WHERE c.comment_id = :comment_id
    """), {'comment_id': comment_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_by_task(task_id: int, db: AsyncSession):
    """Task의 전체 댓글 — soft delete 규칙 적용 후 평면 배열 반환.

    - deleted_at IS NULL → 그대로
    - deleted_at IS NOT NULL + 답글 있음 → tombstone (UI에서 content 빈 문자열로 노출)
    - deleted_at IS NOT NULL + 답글 없음 → 제외
    """
    # NOTE: idx_task_comment_task is partial (WHERE deleted_at IS NULL).
    # Tombstone rows (deleted_at NOT NULL with live children) fall outside that index — full scan at high volume.
    result = await db.execute(text("""
        WITH child_count AS (
            SELECT parent_comment_id, COUNT(*) AS n
            FROM task_comment
            WHERE task_id = :task_id
              AND parent_comment_id IS NOT NULL
              AND deleted_at IS NULL
            GROUP BY parent_comment_id
        )
        SELECT c.comment_id, c.task_id, c.parent_comment_id, c.author_id,
               c.content, c.is_edited,
               c.created_at, c.updated_at, c.deleted_at,
               u.username, u.avatar_url
        FROM task_comment c
        INNER JOIN "user" u ON c.author_id = u.user_id
        LEFT JOIN child_count cc ON cc.parent_comment_id = c.comment_id
        WHERE c.task_id = :task_id
          AND (
              c.deleted_at IS NULL
              OR COALESCE(cc.n, 0) > 0
          )
        ORDER BY c.created_at ASC
    """), {'task_id': task_id})
    return [dict(r._mapping) for r in result.fetchall()]


# ---- Update ----

async def update_content(comment_id: int, content: str, db: AsyncSession):
    """댓글 내용 수정"""
    await db.execute(text("""
        UPDATE task_comment
        SET content = :content,
            is_edited = TRUE,
            updated_at = NOW()
        WHERE comment_id = :comment_id
    """), {'comment_id': comment_id, 'content': content})


async def soft_delete(comment_id: int, db: AsyncSession):
    """댓글 soft delete"""
    await db.execute(text("""
        UPDATE task_comment
        SET deleted_at = NOW()
        WHERE comment_id = :comment_id
    """), {'comment_id': comment_id})


# ---- Mentions ----

async def get_mentions(comment_id: int, db: AsyncSession) -> list[int]:
    """댓글의 멘션 user_id 목록"""
    result = await db.execute(text("""
        SELECT user_id FROM task_comment_mention WHERE comment_id = :comment_id
    """), {'comment_id': comment_id})
    return [row[0] for row in result.fetchall()]


async def get_mentions_bulk(comment_ids: list[int], db: AsyncSession) -> dict[int, list[int]]:
    """여러 comment_id의 멘션 user_ids를 한 쿼리로 묶어서 가져옴 (N+1 방지)"""
    if not comment_ids:
        return {}
    result = await db.execute(text("""
        SELECT comment_id, user_id FROM task_comment_mention
        WHERE comment_id = ANY(CAST(:ids AS bigint[]))
    """), {'ids': list(set(comment_ids))})
    bucket: dict[int, list[int]] = {}
    for row in result.fetchall():
        bucket.setdefault(row[0], []).append(row[1])
    return bucket


async def add_mentions(comment_id: int, user_ids: list[int], db: AsyncSession):
    """멘션 추가 (중복 무시)"""
    if not user_ids:
        return
    await db.execute(
        text("""
            INSERT INTO task_comment_mention (comment_id, user_id)
            SELECT :comment_id, unnest(CAST(:user_ids AS bigint[]))
            ON CONFLICT DO NOTHING
        """),
        {'comment_id': comment_id, 'user_ids': list(set(user_ids))},
    )


async def remove_mentions(comment_id: int, user_ids: list[int], db: AsyncSession):
    """멘션 제거"""
    if not user_ids:
        return
    await db.execute(
        text("""
            DELETE FROM task_comment_mention
            WHERE comment_id = :comment_id
              AND user_id = ANY(CAST(:user_ids AS bigint[]))
        """),
        {'comment_id': comment_id, 'user_ids': list(set(user_ids))},
    )
