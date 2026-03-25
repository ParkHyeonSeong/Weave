from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import schedule_event as event_model
from core.model import branch_member as member_model
from core.model import task as task_model
from core.model import epic as epic_model


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
    if body.participant_ids is not None:
        await event_model.set_participants(event_id, body.participant_ids, db)
    return {'status': True, 'schedule_event_id': event_id}


async def get_list(branch_id: int, range_start, range_end, request: Request, db: AsyncSession):
    """Schedule event 목록 (날짜 범위)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    events = await event_model.find_by_branch_and_range(branch_id, range_start, range_end, db)
    # 이벤트별 참석자 일괄 조회
    for evt in events:
        evt['participants'] = await event_model.find_participants(evt['schedule_event_id'], db)
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
    fields.pop('participant_ids', None)
    await event_model.update(event_id, fields, db)
    if body.participant_ids is not None:
        await event_model.set_participants(event_id, body.participant_ids, db)
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


async def get_calendar_tasks(branch_id: int, range_start, range_end, request: Request, db: AsyncSession):
    """캘린더 표시용 Task 목록"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    tasks = await task_model.find_for_calendar(branch_id, range_start, range_end, db)
    return {'status': True, 'tasks': tasks}


async def get_calendar_epics(branch_id: int, range_start, range_end, request: Request, db: AsyncSession):
    """캘린더 표시용 Epic 목록"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    epics = await epic_model.find_for_calendar(branch_id, range_start, range_end, db)
    return {'status': True, 'epics': epics}
