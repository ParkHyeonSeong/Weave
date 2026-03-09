from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import epic as epic_model
from core.model import branch_member as member_model


async def create(body, branch_id: int, request: Request, db: AsyncSession):
    """Epic 생성"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

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


async def update(epic_id: int, body, branch_id: int, request: Request, db: AsyncSession):
    """Epic 수정"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    epic = await epic_model.find_by_id(epic_id, db)
    if not epic or epic['branch_id'] != branch_id:
        return {'status': False, 'message': 'EPIC_NOT_FOUND'}

    fields = body.model_dump(exclude_none=True)
    await epic_model.update(epic_id, fields, db)
    return {'status': True}


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
