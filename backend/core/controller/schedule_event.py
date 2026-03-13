from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import schedule_event as event_model
from core.model import branch_member as member_model


async def create(body, branch_id: int, request: Request, db: AsyncSession):
    """Schedule event 생성"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    event_id = await event_model.create(
        branch_id=branch_id,
        title=body.title,
        description=body.description,
        start_date=body.start_date,
        end_date=body.end_date,
        color=body.color or '#5E6AD2',
        created_by=user_id,
        db=db,
    )
    return {'status': True, 'schedule_event_id': event_id}


async def get_list(branch_id: int, range_start, range_end, request: Request, db: AsyncSession):
    """Schedule event 목록 (날짜 범위)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    events = await event_model.find_by_branch_and_range(branch_id, range_start, range_end, db)
    return {'status': True, 'events': events}


async def update(event_id: int, body, branch_id: int, request: Request, db: AsyncSession):
    """Schedule event 수정"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    event = await event_model.find_by_id(event_id, db)
    if not event or event['branch_id'] != branch_id:
        return {'status': False, 'message': 'EVENT_NOT_FOUND'}

    fields = body.model_dump(exclude_none=True)
    await event_model.update(event_id, fields, db)
    return {'status': True}


async def delete(event_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Schedule event 삭제"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    event = await event_model.find_by_id(event_id, db)
    if not event or event['branch_id'] != branch_id:
        return {'status': False, 'message': 'EVENT_NOT_FOUND'}

    await event_model.delete(event_id, db)
    return {'status': True}
