from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import sprint as sprint_model
from core.model import branch_member as member_model


async def create(body, branch_id: int, request: Request, db: AsyncSession):
    """Sprint 생성"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    sprint_id = await sprint_model.create(
        branch_id=branch_id,
        sprint_name=body.sprint_name,
        goal=body.goal,
        start_date=body.start_date,
        end_date=body.end_date,
        created_by=user_id,
        db=db,
    )
    return {'status': True, 'sprint_id': sprint_id}


async def get_list(branch_id: int, request: Request, db: AsyncSession):
    """Sprint 목록"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    sprints = await sprint_model.find_by_branch(branch_id, db)
    return {'status': True, 'sprints': sprints}


async def update(sprint_id: int, body, branch_id: int, request: Request, db: AsyncSession):
    """Sprint 수정"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    sprint = await sprint_model.find_by_id(sprint_id, db)
    if not sprint or sprint['branch_id'] != branch_id:
        return {'status': False, 'message': 'SPRINT_NOT_FOUND'}

    fields = body.model_dump(exclude_none=True)

    # active 스프린트 1개 제한
    if fields.get('status') == 'active':
        existing_active = await sprint_model.find_active(branch_id, db)
        if existing_active and existing_active != sprint_id:
            return {'status': False, 'message': 'ACTIVE_SPRINT_EXISTS'}

    await sprint_model.update(sprint_id, fields, db)
    return {'status': True}


async def delete(sprint_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Sprint 삭제"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    sprint = await sprint_model.find_by_id(sprint_id, db)
    if not sprint or sprint['branch_id'] != branch_id:
        return {'status': False, 'message': 'SPRINT_NOT_FOUND'}

    await sprint_model.delete(sprint_id, db)
    return {'status': True}
