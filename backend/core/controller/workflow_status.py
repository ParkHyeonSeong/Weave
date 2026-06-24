from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import workflow_status as ws_model
from core.model import branch_member as member_model
from core.guard.branch_scope import find_resource_in_branch


async def list_statuses(branch_id: int, request: Request, db: AsyncSession):
    """Workflow status 목록"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    statuses = await ws_model.find_by_branch(branch_id, db)
    return {'status': True, 'statuses': statuses}


async def create_status(branch_id: int, body, request: Request, db: AsyncSession):
    """Workflow status 생성 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

    # key 중복 체크
    existing = await ws_model.find_by_key(branch_id, body.key, db)
    if existing:
        return error_response(ErrorCode.KEY_ALREADY_EXISTS)

    # sort_order: 현재 최대값 + 1
    statuses = await ws_model.find_by_branch(branch_id, db)
    max_order = max((s['sort_order'] for s in statuses), default=-1)

    ws_id = await ws_model.create(
        branch_id=branch_id,
        key=body.key,
        label=body.label,
        color=body.color,
        category=body.category,
        sort_order=max_order + 1,
        is_default=False,
        db=db,
    )
    return {'status': True, 'workflow_status_id': ws_id}


async def update_status(branch_id: int, status_id: int, body, request: Request, db: AsyncSession):
    """Workflow status 수정 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

    # IDOR 방어: status_id가 실제로 branch_id에 속하는지 검증
    if await find_resource_in_branch(status_id, branch_id, 'workflow_status', db) is None:
        return error_response(ErrorCode.STATUS_NOT_FOUND)

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {'status': True}

    # is_default 변경시 기존 default 해제
    if fields.get('is_default'):
        await ws_model.clear_default(branch_id, db)

    await ws_model.update(status_id, fields, db)
    return {'status': True}


async def delete_status(branch_id: int, status_id: int, request: Request, db: AsyncSession):
    """Workflow status 삭제 (admin만, 사용 중이면 거부)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

    statuses = await ws_model.find_by_branch(branch_id, db)
    target = next((s for s in statuses if s['workflow_status_id'] == status_id), None)
    if not target:
        return error_response(ErrorCode.STATUS_NOT_FOUND)

    # 최소 1개는 남아야 함
    if len(statuses) <= 1:
        return error_response(ErrorCode.CANNOT_DELETE_LAST_STATUS)

    # 사용 중인 task가 있으면 삭제 불가
    count = await ws_model.count_tasks_with_status(branch_id, target['key'], db)
    if count > 0:
        return error_response(ErrorCode.STATUS_IN_USE)

    await ws_model.delete(status_id, db)
    return {'status': True}


async def reorder_statuses(branch_id: int, body, request: Request, db: AsyncSession):
    """Workflow status 순서 변경"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

    # IDOR 방어: 모든 items의 id가 branch_id에 속하는지 단일 COUNT 쿼리로 검증
    # (all-or-nothing). 누락/None id도 거부. 빈 items는 통과(기존 동작 유지).
    req_ids = [item.get('id') for item in body.items]
    if any(i is None for i in req_ids):
        return error_response(ErrorCode.STATUS_NOT_FOUND)
    uniq = set(req_ids)
    if uniq and await ws_model.count_ids_in_branch(branch_id, list(uniq), db) != len(uniq):
        return error_response(ErrorCode.STATUS_NOT_FOUND)

    await ws_model.reorder(body.items, db)
    return {'status': True}
