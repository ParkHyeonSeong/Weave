from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import activity_log as log_model
from core.model import branch_member as member_model
from core.model import canvas_member as canvas_member_model


async def get_task_activity(task_id: int, branch_id: int, limit: int, offset: int,
                            request: Request, db: AsyncSession):
    """Task 활동 이력"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    activities = await log_model.find_by_entity('task', task_id, limit, offset, db)
    return {'status': True, 'activities': activities}


async def get_branch_activity(branch_id: int, limit: int, offset: int,
                              request: Request, db: AsyncSession):
    """브랜치 전체 활동 피드"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    activities = await log_model.find_by_branch(branch_id, limit, offset, db)
    return {'status': True, 'activities': activities}


async def get_canvas_page_activity(canvas_id: int, page_id: int, limit: int, offset: int,
                                   request: Request, db: AsyncSession):
    """Canvas 페이지 활동 이력"""
    user_id = request.state.payload.get('user_id')
    if not await canvas_member_model.is_member(canvas_id, user_id, db):
        return {'status': False, 'message': 'NOT_CANVAS_MEMBER'}

    activities = await log_model.find_by_entity('canvas_page', page_id, limit, offset, db)
    return {'status': True, 'activities': activities}


async def get_canvas_activity(canvas_id: int, limit: int, offset: int,
                              request: Request, db: AsyncSession):
    """캔버스 전체 활동 피드"""
    user_id = request.state.payload.get('user_id')
    if not await canvas_member_model.is_member(canvas_id, user_id, db):
        return {'status': False, 'message': 'NOT_CANVAS_MEMBER'}

    activities = await log_model.find_by_canvas(canvas_id, limit, offset, db)
    return {'status': True, 'activities': activities}
