from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import task_page_link as link_model
from core.model import branch_member as member_model
from core.model import task as task_model


async def _check_member(branch_id: int, request: Request, db: AsyncSession):
    """Branch 멤버 확인"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return None, {'status': False, 'message': 'NOT_BRANCH_MEMBER'}
    return user_id, None


async def link_page(body, branch_id: int, task_id: int, request: Request, db: AsyncSession):
    """태스크에 캔버스 페이지 연결"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    try:
        link_id = await link_model.create(task_id, body.page_id, user_id, db)
    except Exception:
        return {'status': False, 'message': 'DUPLICATE_LINK'}

    return {'status': True, 'link_id': link_id}


async def get_pages(branch_id: int, task_id: int, request: Request, db: AsyncSession):
    """태스크에 연결된 페이지 목록"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    pages = await link_model.find_by_task(task_id, db)
    return {'status': True, 'pages': pages}


async def unlink_page(branch_id: int, task_id: int, link_id: int,
                      request: Request, db: AsyncSession):
    """태스크-페이지 연결 해제"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    await link_model.delete(link_id, db)
    return {'status': True}


async def search_pages(branch_id: int, task_id: int, keyword: str,
                       request: Request, db: AsyncSession):
    """연결 가능한 페이지 검색"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    pages = await link_model.search_pages(user_id, keyword, task_id, db)
    return {'status': True, 'pages': pages}
