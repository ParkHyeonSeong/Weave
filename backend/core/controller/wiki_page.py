from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import wiki_page as page_model
from core.model import canvas_member as member_model


async def create(canvas_id: int, body, request: Request, db: AsyncSession):
    """Wiki 페이지/폴더 생성"""
    user_id = request.state.payload.get('user_id')

    if not await member_model.is_member(canvas_id, user_id, db):
        return {'status': False, 'message': 'NOT_CANVAS_MEMBER'}

    position = await page_model.get_next_position(canvas_id, body.parent_page_id, db)

    page_id = await page_model.create(
        canvas_id=canvas_id,
        title=body.title,
        content=body.content or '',
        parent_page_id=body.parent_page_id,
        position=position,
        created_by=user_id,
        page_type=body.type,
        db=db,
    )

    return {'status': True, 'page_id': page_id}


async def get_tree(canvas_id: int, request: Request, db: AsyncSession):
    """Canvas 내 페이지 트리"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(canvas_id, user_id, db):
        return {'status': False, 'message': 'NOT_CANVAS_MEMBER'}

    pages = await page_model.find_tree(canvas_id, db)
    return {'status': True, 'pages': pages}


async def get_detail(canvas_id: int, page_id: int, request: Request, db: AsyncSession):
    """페이지 상세 (content 포함)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(canvas_id, user_id, db):
        return {'status': False, 'message': 'NOT_CANVAS_MEMBER'}

    page = await page_model.find_by_id(page_id, db)
    if not page or page['canvas_id'] != canvas_id:
        return {'status': False, 'message': 'PAGE_NOT_FOUND'}

    return {'status': True, 'page': page}


async def update(canvas_id: int, page_id: int, body, request: Request, db: AsyncSession):
    """페이지 수정"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(canvas_id, user_id, db):
        return {'status': False, 'message': 'NOT_CANVAS_MEMBER'}

    page = await page_model.find_by_id(page_id, db)
    if not page or page['canvas_id'] != canvas_id:
        return {'status': False, 'message': 'PAGE_NOT_FOUND'}

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {'status': True}

    await page_model.update(page_id, fields, user_id, db)
    return {'status': True}


async def move(canvas_id: int, page_id: int, body, request: Request, db: AsyncSession):
    """페이지/폴더 이동 (DnD용)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(canvas_id, user_id, db):
        return {'status': False, 'message': 'NOT_CANVAS_MEMBER'}

    page = await page_model.find_by_id(page_id, db)
    if not page or page['canvas_id'] != canvas_id:
        return {'status': False, 'message': 'PAGE_NOT_FOUND'}

    # overview 페이지는 이동 불가
    if page['type'] == 'overview':
        return {'status': False, 'message': 'CANNOT_MOVE_OVERVIEW'}

    await page_model.update(page_id, {
        'parent_page_id': body.parent_page_id,
        'position': body.position,
    }, user_id, db)
    return {'status': True}


async def delete(canvas_id: int, page_id: int, request: Request, db: AsyncSession):
    """페이지 아카이브 (하위 페이지 포함)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(canvas_id, user_id, db):
        return {'status': False, 'message': 'NOT_CANVAS_MEMBER'}

    page = await page_model.find_by_id(page_id, db)
    if not page or page['canvas_id'] != canvas_id:
        return {'status': False, 'message': 'PAGE_NOT_FOUND'}

    # overview 페이지는 삭제 불가
    if page['type'] == 'overview':
        return {'status': False, 'message': 'CANNOT_DELETE_OVERVIEW'}

    await page_model.archive(page_id, db)
    return {'status': True}
