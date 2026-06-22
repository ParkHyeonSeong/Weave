from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import epic as epic_model
from core.model import task as task_model
from core.model import branch_member as member_model
from library.date_validator import is_valid_date_order


async def create(body, branch_id: int, request: Request, db: AsyncSession):
    """Epic 생성"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    if not is_valid_date_order(body.start_date, body.due_date):
        return {'status': False, 'message': 'INVALID_DATE_RANGE'}

    epic_id = await epic_model.create(
        branch_id=branch_id,
        epic_name=body.epic_name,
        description=body.description,
        status=body.status,
        color=body.color,
        start_date=body.start_date,
        due_date=body.due_date,
        created_by=user_id,
        db=db,
    )
    return {'status': True, 'epic_id': epic_id}


async def get_list(branch_id: int, request: Request, db: AsyncSession):
    """Epic 목록 (task count 포함)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    epics = await epic_model.find_by_branch(branch_id, db)
    return {'status': True, 'epics': epics}


async def get_detail(epic_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Epic 단건 조회"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    epic = await epic_model.find_by_id(epic_id, db)
    if not epic or epic['branch_id'] != branch_id:
        return {'status': False, 'message': 'EPIC_NOT_FOUND'}

    return {'status': True, 'epic': epic}


async def update(epic_id: int, body, branch_id: int, request: Request, db: AsyncSession):
    """Epic 수정"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    epic = await epic_model.find_by_id(epic_id, db)
    if not epic or epic['branch_id'] != branch_id:
        return {'status': False, 'message': 'EPIC_NOT_FOUND'}

    fields = body.model_dump(exclude_none=True)
    # 명시적 null로 보낸 날짜만 clear 허용 (epic_name/color/status 등 NOT NULL의 null은 드롭됨)
    for f in ('start_date', 'due_date'):
        if f in body.model_fields_set and getattr(body, f) is None:
            fields[f] = None
    new_start = fields.get('start_date', epic['start_date'])
    new_due = fields.get('due_date', epic['due_date'])
    if not is_valid_date_order(new_start, new_due):
        return {'status': False, 'message': 'INVALID_DATE_RANGE'}
    await epic_model.update(epic_id, fields, db)
    return {'status': True}


async def get_tasks(epic_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Epic에 속한 Task 목록"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    tasks = await task_model.find_by_epic(epic_id, branch_id, db)
    return {'status': True, 'tasks': tasks}


async def reorder(body, branch_id: int, request: Request, db: AsyncSession):
    """Epic 순서 변경"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    await epic_model.reorder(branch_id, body.epic_ids, db)
    return {'status': True}


async def delete(epic_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Epic 삭제"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    epic = await epic_model.find_by_id(epic_id, db)
    if not epic or epic['branch_id'] != branch_id:
        return {'status': False, 'message': 'EPIC_NOT_FOUND'}

    await epic_model.delete(epic_id, db)
    return {'status': True}
