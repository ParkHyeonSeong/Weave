from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# -- 앵커(스레드) --

async def create_annotation(
    page_id: int, created_by: int,
    quoted_text: str, prefix_context: str, suffix_context: str,
    anchor_node_path: str, anchor_offset: int, anchor_length: int,
    db: AsyncSession
) -> int:
    """앵커 생성"""
    result = await db.execute(text("""
        INSERT INTO canvas_annotation
            (page_id, created_by, quoted_text, prefix_context, suffix_context,
             anchor_node_path, anchor_offset, anchor_length)
        VALUES
            (:page_id, :created_by, :quoted_text, :prefix_context, :suffix_context,
             :anchor_node_path, :anchor_offset, :anchor_length)
        RETURNING annotation_id
    """), {
        'page_id': page_id, 'created_by': created_by,
        'quoted_text': quoted_text,
        'prefix_context': prefix_context, 'suffix_context': suffix_context,
        'anchor_node_path': anchor_node_path,
        'anchor_offset': anchor_offset, 'anchor_length': anchor_length,
    })
    return result.scalar_one()


async def find_by_page(page_id: int, status: str | None, db: AsyncSession):
    """페이지의 앵커 목록"""
    where = "WHERE a.page_id = :page_id"
    params: dict = {'page_id': page_id}
    if status:
        where += " AND a.status = :status"
        params['status'] = status
    result = await db.execute(text(f"""
        SELECT a.annotation_id, a.page_id, a.created_by, a.quoted_text,
               a.prefix_context, a.suffix_context,
               a.anchor_node_path, a.anchor_offset, a.anchor_length,
               a.status, a.resolved_by, a.resolved_at,
               a.created_at, a.updated_at,
               u.username AS author_name,
               (SELECT COUNT(*) FROM canvas_annotation_reply r
                WHERE r.annotation_id = a.annotation_id) AS reply_count
        FROM canvas_annotation a
        INNER JOIN "user" u ON a.created_by = u.user_id
        {where}
        ORDER BY a.created_at ASC
    """), params)
    return [dict(r._mapping) for r in result.fetchall()]


async def find_by_id(annotation_id: int, db: AsyncSession):
    """앵커 상세"""
    result = await db.execute(text("""
        SELECT a.annotation_id, a.page_id, a.created_by, a.quoted_text,
               a.prefix_context, a.suffix_context,
               a.anchor_node_path, a.anchor_offset, a.anchor_length,
               a.status, a.resolved_by, a.resolved_at,
               a.created_at, a.updated_at,
               u.username AS author_name
        FROM canvas_annotation a
        INNER JOIN "user" u ON a.created_by = u.user_id
        WHERE a.annotation_id = :annotation_id
    """), {'annotation_id': annotation_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def update_status(annotation_id: int, status: str, resolved_by: int | None, db: AsyncSession):
    """앵커 상태 변경 (resolve/reopen)"""
    if status == 'resolved':
        await db.execute(text("""
            UPDATE canvas_annotation
            SET status = 'resolved', resolved_by = :resolved_by, resolved_at = NOW(), updated_at = NOW()
            WHERE annotation_id = :annotation_id
        """), {'annotation_id': annotation_id, 'resolved_by': resolved_by})
    else:
        await db.execute(text("""
            UPDATE canvas_annotation
            SET status = 'open', resolved_by = NULL, resolved_at = NULL, updated_at = NOW()
            WHERE annotation_id = :annotation_id
        """), {'annotation_id': annotation_id})


async def delete_annotation(annotation_id: int, db: AsyncSession):
    """앵커 삭제 (답글도 CASCADE 삭제)"""
    await db.execute(text("""
        DELETE FROM canvas_annotation WHERE annotation_id = :annotation_id
    """), {'annotation_id': annotation_id})


async def get_page_id(annotation_id: int, db: AsyncSession):
    """앵커의 page_id 조회"""
    result = await db.execute(text("""
        SELECT page_id FROM canvas_annotation WHERE annotation_id = :annotation_id
    """), {'annotation_id': annotation_id})
    row = result.fetchone()
    return row[0] if row else None


# -- 답글 --

async def create_reply(annotation_id: int, author_id: int, content: str, db: AsyncSession) -> int:
    """답글 생성"""
    result = await db.execute(text("""
        INSERT INTO canvas_annotation_reply (annotation_id, author_id, content)
        VALUES (:annotation_id, :author_id, :content)
        RETURNING reply_id
    """), {'annotation_id': annotation_id, 'author_id': author_id, 'content': content})
    return result.scalar_one()


async def find_replies(annotation_id: int, db: AsyncSession):
    """앵커의 답글 목록"""
    result = await db.execute(text("""
        SELECT r.reply_id, r.annotation_id, r.author_id, r.content,
               r.created_at, r.updated_at,
               u.username AS author_name
        FROM canvas_annotation_reply r
        INNER JOIN "user" u ON r.author_id = u.user_id
        WHERE r.annotation_id = :annotation_id
        ORDER BY r.created_at ASC
    """), {'annotation_id': annotation_id})
    return [dict(r._mapping) for r in result.fetchall()]


async def find_reply_by_id(reply_id: int, db: AsyncSession):
    """답글 상세"""
    result = await db.execute(text("""
        SELECT reply_id, annotation_id, author_id, content, created_at, updated_at
        FROM canvas_annotation_reply
        WHERE reply_id = :reply_id
    """), {'reply_id': reply_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def update_reply(reply_id: int, content: str, db: AsyncSession):
    """답글 수정"""
    await db.execute(text("""
        UPDATE canvas_annotation_reply SET content = :content, updated_at = NOW()
        WHERE reply_id = :reply_id
    """), {'reply_id': reply_id, 'content': content})


async def delete_reply(reply_id: int, db: AsyncSession):
    """답글 삭제"""
    await db.execute(text("""
        DELETE FROM canvas_annotation_reply WHERE reply_id = :reply_id
    """), {'reply_id': reply_id})


async def find_replier_ids(annotation_id: int, db: AsyncSession) -> list[int]:
    """앵커의 고유 답글 작성자 user_id 목록"""
    result = await db.execute(text("""
        SELECT DISTINCT author_id FROM canvas_annotation_reply
        WHERE annotation_id = :annotation_id
    """), {'annotation_id': annotation_id})
    return [r[0] for r in result.fetchall()]
