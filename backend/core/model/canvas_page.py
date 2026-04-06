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


async def move_page(page_id: int, canvas_id: int, new_parent_id, new_position: int,
                    updated_by: int, db: AsyncSession):
    """페이지 이동 (형제 position 자동 재정렬)"""
    # 현재 페이지 정보
    row = await db.execute(text("""
        SELECT parent_page_id, position FROM canvas_page
        WHERE page_id = :page_id AND is_archived = FALSE
    """), {'page_id': page_id})
    current = row.fetchone()
    if not current:
        return
    old_parent_id = current.parent_page_id
    old_position = current.position

    # 1. 기존 부모에서 갭 정리 (이동 아이템 뒤 형제들 position-1)
    await db.execute(text("""
        UPDATE canvas_page SET position = position - 1
        WHERE canvas_id = :canvas_id
          AND parent_page_id IS NOT DISTINCT FROM :old_parent_id
          AND position > :old_position
          AND page_id != :page_id
          AND is_archived = FALSE
    """), {
        'canvas_id': canvas_id,
        'old_parent_id': old_parent_id,
        'old_position': old_position,
        'page_id': page_id,
    })

    # 2. 새 부모에서 공간 확보 (삽입 위치 이후 형제들 position+1)
    await db.execute(text("""
        UPDATE canvas_page SET position = position + 1
        WHERE canvas_id = :canvas_id
          AND parent_page_id IS NOT DISTINCT FROM :new_parent_id
          AND position >= :new_position
          AND page_id != :page_id
          AND is_archived = FALSE
    """), {
        'canvas_id': canvas_id,
        'new_parent_id': new_parent_id,
        'new_position': new_position,
        'page_id': page_id,
    })

    # 3. 페이지 이동
    await db.execute(text("""
        UPDATE canvas_page
        SET parent_page_id = :new_parent_id, position = :new_position,
            updated_by = :updated_by, updated_at = NOW()
        WHERE page_id = :page_id
    """), {
        'new_parent_id': new_parent_id,
        'new_position': new_position,
        'updated_by': updated_by,
        'page_id': page_id,
    })



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


async def copy_page(page_id: int, parent_page_id: int | None,
                    created_by: int, db: AsyncSession) -> int:
    """페이지 복제 (content만 복사, yjs_state 미복사)"""
    original = await find_by_id(page_id, db)
    if not original:
        return None

    canvas_id = original['canvas_id']
    target_parent = parent_page_id if parent_page_id is not None else original.get('parent_page_id')
    position = await get_next_position(canvas_id, target_parent, db)

    new_title = f"{original['title']} (copy)"
    return await create(
        canvas_id=canvas_id,
        title=new_title,
        content=original.get('content') or '',
        parent_page_id=target_parent,
        position=position,
        created_by=created_by,
        page_type=original['type'],
        db=db,
    )


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
