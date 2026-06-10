from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import task_type_config as type_model
from core.model import branch_member as member_model
from core.guard.branch_scope import find_resource_in_branch


async def get_list(branch_id: int, request: Request, db: AsyncSession):
    """Task type 목록"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    types = await type_model.find_by_branch(branch_id, db)
    return {'status': True, 'task_types': types}


async def create(branch_id: int, body, request: Request, db: AsyncSession):
    """Task type 생성 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    # key 중복 체크
    existing = await type_model.find_by_key(branch_id, body.type_key, db)
    if existing:
        return {'status': False, 'message': 'TYPE_KEY_ALREADY_EXISTS'}

    # sort_order: 현재 최대값 + 1
    types = await type_model.find_by_branch(branch_id, db)
    max_order = max((t['sort_order'] for t in types), default=-1)

    type_id = await type_model.create(
        branch_id=branch_id,
        type_key=body.type_key,
        type_name=body.type_name,
        icon=body.icon,
        color=body.color,
        sort_order=max_order + 1,
        db=db,
    )
    return {'status': True, 'type_id': type_id}


async def update(branch_id: int, type_id: int, body, request: Request, db: AsyncSession):
    """Task type 수정 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    # Branch 경계 검증: type_id가 해당 branch에 속하는지 확인 (cross-branch IDOR 차단)
    if not await find_resource_in_branch(type_id, branch_id, 'task_type', db):
        return {'status': False, 'message': 'TYPE_NOT_FOUND'}

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {'status': True}

    await type_model.update(type_id, fields, db)
    return {'status': True}


async def delete(branch_id: int, type_id: int, request: Request, db: AsyncSession):
    """Task type 삭제 (admin만, 사용 중이면 거부)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    # 해당 type의 정보 조회
    types = await type_model.find_by_branch(branch_id, db)
    target = next((t for t in types if t['type_id'] == type_id), None)
    if not target:
        return {'status': False, 'message': 'TYPE_NOT_FOUND'}

    # 최소 1개 타입은 남아야 함
    if len(types) <= 1:
        return {'status': False, 'message': 'CANNOT_DELETE_LAST_TYPE'}

    # 사용 중인 task가 있으면 삭제 불가
    count = await type_model.count_tasks_by_type(branch_id, target['type_key'], db)
    if count > 0:
        return {'status': False, 'message': 'TYPE_IN_USE'}

    await type_model.delete(type_id, db)
    return {'status': True}
