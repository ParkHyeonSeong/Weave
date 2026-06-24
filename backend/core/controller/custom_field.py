from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import custom_field as cf_model
from core.model import branch_member as member_model
from core.guard.branch_scope import find_resource_in_branch


async def _verify_type_belongs_to_branch(type_id: int, branch_id: int, db: AsyncSession):
    """task type이 해당 branch에 속하는지 확인"""
    return await find_resource_in_branch(type_id, branch_id, 'task_type', db) is not None


async def list_fields(branch_id: int, type_id: int, request: Request, db: AsyncSession):
    """Custom field 목록"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    if not await _verify_type_belongs_to_branch(type_id, branch_id, db):
        return error_response(ErrorCode.TYPE_NOT_FOUND)

    fields = await cf_model.find_by_type(type_id, db)
    return {'status': True, 'fields': fields}


async def create_field(branch_id: int, type_id: int, body, request: Request, db: AsyncSession):
    """Custom field 생성 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

    if not await _verify_type_belongs_to_branch(type_id, branch_id, db):
        return error_response(ErrorCode.TYPE_NOT_FOUND)

    # sort_order: 현재 최대값 + 1
    fields = await cf_model.find_by_type(type_id, db)
    max_order = max((f['sort_order'] for f in fields), default=-1)

    field_id = await cf_model.create(
        type_id=type_id,
        field_name=body.field_name,
        field_type=body.field_type,
        field_options=body.field_options,
        is_required=body.is_required,
        sort_order=max_order + 1,
        db=db,
    )
    return {'status': True, 'custom_field_id': field_id}


async def update_field(branch_id: int, type_id: int, field_id: int, body, request: Request, db: AsyncSession):
    """Custom field 수정 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

    if not await _verify_type_belongs_to_branch(type_id, branch_id, db):
        return error_response(ErrorCode.TYPE_NOT_FOUND)

    field = await cf_model.find_by_id(field_id, db)
    if not field or field['type_id'] != type_id:
        return error_response(ErrorCode.FIELD_NOT_FOUND)

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {'status': True}

    await cf_model.update(field_id, fields, db)
    return {'status': True}


async def delete_field(branch_id: int, type_id: int, field_id: int, request: Request, db: AsyncSession):
    """Custom field 삭제 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

    if not await _verify_type_belongs_to_branch(type_id, branch_id, db):
        return error_response(ErrorCode.TYPE_NOT_FOUND)

    field = await cf_model.find_by_id(field_id, db)
    if not field or field['type_id'] != type_id:
        return error_response(ErrorCode.FIELD_NOT_FOUND)

    await cf_model.delete(field_id, db)
    return {'status': True}


async def reorder_fields(branch_id: int, type_id: int, body, request: Request, db: AsyncSession):
    """Custom field 순서 변경 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

    if not await _verify_type_belongs_to_branch(type_id, branch_id, db):
        return error_response(ErrorCode.TYPE_NOT_FOUND)

    # IDOR 방어: 모든 items의 id가 type_id에 속하는 field인지 단일 COUNT 쿼리로
    # 검증 (all-or-nothing). 빈 items는 통과(기존 동작 유지).
    uniq = {item.id for item in body.items}
    if uniq and await cf_model.count_ids_in_type(type_id, list(uniq), db) != len(uniq):
        return error_response(ErrorCode.FIELD_NOT_FOUND)

    await cf_model.reorder(body.items, db)
    return {'status': True}
