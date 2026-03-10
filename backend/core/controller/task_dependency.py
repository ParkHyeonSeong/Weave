from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import task_dependency as dep_model
from core.model import task as task_model
from core.model import branch_member as member_model


async def create(body, branch_id: int, request: Request, db: AsyncSession):
    """의존관계 생성"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    # 자기 참조 방지
    if body.source_task_id == body.target_task_id:
        return {'status': False, 'message': 'SELF_DEPENDENCY'}

    # 유효한 dep_type 확인
    if body.dep_type not in ('finish_to_start', 'relates_to'):
        return {'status': False, 'message': 'INVALID_DEP_TYPE'}

    # 순환 참조 체크 (finish_to_start만)
    if body.dep_type == 'finish_to_start':
        is_circular = await dep_model.check_circular(
            body.source_task_id, body.target_task_id, branch_id, db
        )
        if is_circular:
            return {'status': False, 'message': 'CIRCULAR_DEPENDENCY'}

    try:
        dep_id = await dep_model.create(
            branch_id=branch_id,
            source_task_id=body.source_task_id,
            target_task_id=body.target_task_id,
            dep_type=body.dep_type,
            created_by=user_id,
            db=db,
        )
        return {'status': True, 'dependency_id': dep_id}
    except Exception:
        return {'status': False, 'message': 'DUPLICATE_DEPENDENCY'}


async def get_by_epic(epic_id: int, branch_id: int, request: Request, db: AsyncSession):
    """에픽의 의존관계 목록"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    deps = await dep_model.find_by_epic(epic_id, branch_id, db)
    return {'status': True, 'dependencies': deps}


async def get_by_task(task_id: int, branch_id: int, request: Request, db: AsyncSession):
    """태스크의 의존관계 목록"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    deps = await dep_model.find_by_task(task_id, branch_id, db)
    return {'status': True, 'dependencies': deps}


async def delete(dependency_id: int, branch_id: int, request: Request, db: AsyncSession):
    """의존관계 삭제"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    await dep_model.delete(dependency_id, branch_id, db)
    return {'status': True}
