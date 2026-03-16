from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(canvas_id: int, title: str, content: str,
                 parent_page_id: int, position: int, created_by: int,
                 page_type: str = 'document', db: AsyncSession = None) -> int:
    """Canvas 페이지 생성"""
    result = await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, parent_page_id, position, created_by, updated_by, type)
        VALUES (:canvas_id, :title, :content, :parent_page_id, :position, :created_by, :created_by, :type)
        RETURNING page_id
    """), {
        'canvas_id': canvas_id,
        'title': title,
        'content': content,
        'parent_page_id': parent_page_id,
        'position': position,
        'created_by': created_by,
        'type': page_type,
    })
    await db.commit()
    return result.scalar_one()


async def find_by_id(page_id: int, db: AsyncSession):
    """페이지 상세 조회 (content 포함)"""
    result = await db.execute(text("""
        SELECT p.page_id, p.canvas_id, p.parent_page_id, p.title,
               p.content, p.position, p.type, p.is_archived, p.wide_mode,
               p.created_by, p.updated_by, p.created_at, p.updated_at,
               p.yjs_state, p.yjs_updated_at,
               u.username AS created_by_name,
               u2.username AS updated_by_name
        FROM canvas_page p
        LEFT JOIN "user" u ON p.created_by = u.user_id
        LEFT JOIN "user" u2 ON p.updated_by = u2.user_id
        WHERE p.page_id = :page_id AND p.is_archived = FALSE
    """), {'page_id': page_id})
    row = result.fetchone()
    if not row:
        return None
    d = dict(row._mapping)
    # yjs_state는 바이너리라 JSON 직렬화 불가 → boolean 플래그로 변환
    d['yjs_state'] = bool(d.get('yjs_state'))
    return d


async def find_by_id_simple(page_id: int, db: AsyncSession):
    """페이지 간단 조회 (채팅 doc_ref 용)"""
    result = await db.execute(text("""
        SELECT p.page_id, p.canvas_id, p.title, c.canvas_name
        FROM canvas_page p
        INNER JOIN canvas c ON p.canvas_id = c.canvas_id
        WHERE p.page_id = :page_id AND p.is_archived = FALSE
    """), {'page_id': page_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_tree(canvas_id: int, db: AsyncSession):
    """Canvas 내 전체 페이지 트리 (content 제외, 가볍게)"""
    result = await db.execute(text("""
        SELECT p.page_id, p.parent_page_id, p.title, p.position, p.type,
               p.created_by, p.updated_at
        FROM canvas_page p
        WHERE p.canvas_id = :canvas_id AND p.is_archived = FALSE
        ORDER BY p.position, p.created_at
    """), {'canvas_id': canvas_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def update(page_id: int, fields: dict, updated_by: int, db: AsyncSession):
    """페이지 수정"""
    fields['updated_by'] = updated_by
    set_clauses = ', '.join(f'{k} = :{k}' for k in fields)
    params = {**fields, 'page_id': page_id}
    await db.execute(text(f"""
        UPDATE canvas_page SET {set_clauses}, updated_at = NOW()
        WHERE page_id = :page_id
    """), params)
    await db.commit()


async def hard_delete(page_id: int, db: AsyncSession):
    """페이지 영구 삭제 (하위 페이지 포함)"""
    # 하위 페이지 포함 recent_view, user_star 정리
    await db.execute(text("""
        WITH RECURSIVE descendants AS (
            SELECT page_id FROM canvas_page WHERE page_id = :page_id
            UNION ALL
            SELECT wp.page_id FROM canvas_page wp
            INNER JOIN descendants d ON wp.parent_page_id = d.page_id
        )
        DELETE FROM recent_view
        WHERE item_type = 'doc' AND item_id IN (SELECT page_id FROM descendants)
    """), {'page_id': page_id})
    await db.execute(text("""
        WITH RECURSIVE descendants AS (
            SELECT page_id FROM canvas_page WHERE page_id = :page_id
            UNION ALL
            SELECT wp.page_id FROM canvas_page wp
            INNER JOIN descendants d ON wp.parent_page_id = d.page_id
        )
        DELETE FROM user_star
        WHERE item_type = 'doc' AND item_id IN (SELECT page_id FROM descendants)
    """), {'page_id': page_id})
    await db.execute(text("""
        WITH RECURSIVE descendants AS (
            SELECT page_id FROM canvas_page WHERE page_id = :page_id
            UNION ALL
            SELECT wp.page_id FROM canvas_page wp
            INNER JOIN descendants d ON wp.parent_page_id = d.page_id
        )
        DELETE FROM canvas_page
        WHERE page_id IN (SELECT page_id FROM descendants)
    """), {'page_id': page_id})
    await db.commit()


async def get_yjs_state(page_id: int, db: AsyncSession) -> bytes | None:
    """페이지의 Yjs 바이너리 상태 조회"""
    result = await db.execute(text("""
        SELECT yjs_state FROM canvas_page WHERE page_id = :page_id
    """), {'page_id': page_id})
    row = result.fetchone()
    return row[0] if row else None


async def save_yjs_state(page_id: int, yjs_state: bytes,
                         html_content: str | None, db: AsyncSession):
    """Yjs document state 저장. html_content가 제공되면 content도 갱신."""
    if html_content is not None:
        await db.execute(text("""
            UPDATE canvas_page
            SET yjs_state = :yjs_state, content = :content,
                yjs_updated_at = NOW(), updated_at = NOW()
            WHERE page_id = :page_id
        """), {'page_id': page_id, 'yjs_state': yjs_state, 'content': html_content})
    else:
        await db.execute(text("""
            UPDATE canvas_page
            SET yjs_state = :yjs_state, yjs_updated_at = NOW(), updated_at = NOW()
            WHERE page_id = :page_id
        """), {'page_id': page_id, 'yjs_state': yjs_state})
    await db.commit()


async def search_for_chat(user_id: int, keyword: str, db: AsyncSession):
    """채팅용 캔버스 페이지 검색 (유저가 접근 가능한 캔버스만)"""
    result = await db.execute(text("""
        SELECT p.page_id, p.canvas_id, p.title,
               c.canvas_name, p.updated_at
        FROM canvas_page p
        INNER JOIN canvas c ON p.canvas_id = c.canvas_id
        INNER JOIN canvas_member cm ON c.canvas_id = cm.canvas_id
        WHERE cm.user_id = :user_id
          AND p.is_archived = FALSE
          AND (p.title ILIKE :keyword OR p.content ILIKE :keyword)
        ORDER BY p.updated_at DESC
        LIMIT 10
    """), {'user_id': user_id, 'keyword': f'%{keyword}%'})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def get_next_position(canvas_id: int, parent_page_id: int, db: AsyncSession) -> int:
    """같은 부모 아래에서 다음 position 값"""
    if parent_page_id:
        result = await db.execute(text("""
            SELECT COALESCE(MAX(position), -1) + 1
            FROM canvas_page
            WHERE canvas_id = :canvas_id AND parent_page_id = :parent_page_id AND is_archived = FALSE
        """), {'canvas_id': canvas_id, 'parent_page_id': parent_page_id})
    else:
        result = await db.execute(text("""
            SELECT COALESCE(MAX(position), -1) + 1
            FROM canvas_page
            WHERE canvas_id = :canvas_id AND parent_page_id IS NULL AND is_archived = FALSE
        """), {'canvas_id': canvas_id})
    return result.scalar_one()
