from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import schedule_event_task as link_model
from core.model import schedule_event as event_model
from core.model import branch_member as member_model


async def link_task(body, branch_id: int, event_id: int, request: Request, db: AsyncSession):
    """이벤트에 태스크 연결"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    event = await event_model.find_by_id(event_id, db)
    if not event or event['branch_id'] != branch_id:
        return error_response(ErrorCode.EVENT_NOT_FOUND)

    try:
        link_id = await link_model.create(event_id, body.task_id, user_id, db)
        return {'status': True, 'link_id': link_id}
    except Exception:
        return error_response(ErrorCode.ALREADY_LINKED)


async def get_linked_tasks(branch_id: int, event_id: int, request: Request, db: AsyncSession):
    """이벤트에 연결된 태스크 목록"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    tasks = await link_model.find_by_event(event_id, db)
    return {'status': True, 'tasks': tasks}


async def unlink_task(branch_id: int, event_id: int, link_id: int, request: Request, db: AsyncSession):
    """이벤트-태스크 연결 해제"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    await link_model.delete(link_id, db)
    return {'status': True}


async def search_tasks(branch_id: int, event_id: int, keyword: str, request: Request, db: AsyncSession):
    """연결 가능한 태스크 검색"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    tasks = await link_model.search_tasks(branch_id, keyword, event_id, db)
    return {'status': True, 'tasks': tasks}
