from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.guard.branch_scope import find_resource_in_branch
from core.model import task_dependency as dep_model
from core.model import branch_member as member_model


async def create(body, branch_id: int, request: Request, db: AsyncSession):
    """의존관계 생성.

    Weave는 cross-branch(프로젝트 간) 의존성을 의도적으로 지원한다. 따라서
    source/target task가 서로 다른 branch에 있어도 막지 않는다 — 대신 호출자가
    *양쪽 task가 속한 branch 모두의 멤버*인지 검증해 IDOR을 차단한다.
    URL의 branch_id 멤버십만 보고 임의 task id를 엮을 수 없게 한다.
    """
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    # 자기 참조 방지
    if body.source_task_id == body.target_task_id:
        return {'status': False, 'message': 'SELF_DEPENDENCY'}

    # 유효한 dep_type 확인
    if body.dep_type not in ('finish_to_start', 'relates_to'):
        return {'status': False, 'message': 'INVALID_DEP_TYPE'}

    # IDOR 방어: 두 task를 unscoped로 조회해 각자의 branch_id를 얻는다.
    # (find_resource_in_branch(.., None, ..)은 branch 필터 없이 행+branch_id 반환)
    source_task = await find_resource_in_branch(body.source_task_id, None, 'task', db)
    if not source_task:
        return {'status': False, 'message': 'TASK_NOT_FOUND'}
    target_task = await find_resource_in_branch(body.target_task_id, None, 'task', db)
    if not target_task:
        return {'status': False, 'message': 'TASK_NOT_FOUND'}

    # IDOR 방어: 호출자가 두 task가 속한 branch 모두의 멤버여야 한다.
    # cross-branch(branch가 다름)여도 양쪽 다 멤버이면 정상 허용 — 기능 보존.
    source_branch_id = source_task['branch_id']
    target_branch_id = target_task['branch_id']
    if not await member_model.is_member(source_branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}
    if source_branch_id != target_branch_id and \
            not await member_model.is_member(target_branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    # 동일 branch면 그 branch_id로 scope, cross-branch면 NULL (045 migration).
    # track.py._try_materialize_flow_dep 와 동일한 규칙.
    dep_branch_id = source_branch_id if source_branch_id == target_branch_id else None

    # 순환 참조 체크 (finish_to_start만)
    if body.dep_type == 'finish_to_start':
        is_circular = await dep_model.check_circular(
            body.source_task_id, body.target_task_id, dep_branch_id, db
        )
        if is_circular:
            return {'status': False, 'message': 'CIRCULAR_DEPENDENCY'}

    try:
        dep_id = await dep_model.create(
            branch_id=dep_branch_id,
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
