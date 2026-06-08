from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import scrum_board as board_model
from core.model import scrum_member as member_model


async def _require_role(board_id: int, request: Request, required: str,
                        db: AsyncSession):
    """보드 존재 + 사용자 role 검증. OK면 None, 아니면 error dict 반환.
    required: 'member' | 'admin'
    """
    if not await board_model.find_by_id(board_id, db):
        return {'status': False, 'message': 'BOARD_NOT_FOUND'}
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(board_id, user_id, db)
    if not member_model.has_at_least(role, required):
        return {'status': False, 'message': 'PERMISSION_DENIED'}
    return None


async def create(body, request: Request, db: AsyncSession):
    """보드 생성 + 생성자를 admin으로 자동 등록"""
    user_id = request.state.payload.get('user_id')
    board_id = await board_model.create(
        name=body.name,
        icon=body.icon,
        color=body.color or '#16A34A',
        visibility=body.visibility or 'private',
        retro_cadence=body.retro_cadence or 'weekly',
        retro_interval_weeks=body.retro_interval_weeks,
        retro_template=body.retro_template or 'kpt',
        retro_anchor_weekday=body.retro_anchor_weekday,
        created_by=user_id,
        db=db,
    )
    await member_model.add(board_id, user_id, 'admin', db)
    return {'status': True, 'board_id': board_id}


async def get_list(request: Request, db: AsyncSession):
    user_id = request.state.payload.get('user_id')
    boards = await board_model.find_accessible(user_id, db)
    return {'status': True, 'boards': boards}


async def get_detail(board_id: int, request: Request, db: AsyncSession):
    board = await board_model.find_by_id(board_id, db)
    if not board:
        return {'status': False, 'message': 'BOARD_NOT_FOUND'}
    user_id = request.state.payload.get('user_id')
    my_role = await member_model.get_role(board_id, user_id, db)
    if board['visibility'] == 'private' and not my_role:
        return {'status': False, 'message': 'ACCESS_DENIED'}
    board['my_role'] = my_role
    board['members'] = await member_model.find_by_board(board_id, db)
    return {'status': True, 'board': board}


async def update(board_id: int, body, request: Request, db: AsyncSession):
    err = await _require_role(board_id, request, 'admin', db)
    if err:
        return err
    fields = body.model_dump(exclude_unset=True)
    if fields:
        await board_model.update(board_id, fields, db)
    return {'status': True}


async def delete(board_id: int, request: Request, db: AsyncSession):
    err = await _require_role(board_id, request, 'admin', db)
    if err:
        return err
    await board_model.archive(board_id, db)
    return {'status': True}


async def get_members(board_id: int, request: Request, db: AsyncSession):
    # get_detail과 동일한 가시성 규칙: public은 누구나, private은 멤버만.
    board = await board_model.find_by_id(board_id, db)
    if not board:
        return {'status': False, 'message': 'BOARD_NOT_FOUND'}
    user_id = request.state.payload.get('user_id')
    my_role = await member_model.get_role(board_id, user_id, db)
    if board['visibility'] == 'private' and not my_role:
        return {'status': False, 'message': 'ACCESS_DENIED'}
    members = await member_model.find_by_board(board_id, db)
    return {'status': True, 'members': members}


async def add_member(board_id: int, body, request: Request, db: AsyncSession):
    err = await _require_role(board_id, request, 'admin', db)
    if err:
        return err
    # add는 upsert(role 갱신)이므로, 기존 admin을 member로 재추가하면 강등이 됨.
    # update_member_role과 동일하게 마지막 admin 강등을 막는다.
    target_role = await member_model.get_role(board_id, body.user_id, db)
    if target_role == 'admin' and body.role != 'admin':
        if await member_model.count_admins(board_id, db) <= 1:
            return {'status': False, 'message': 'LAST_ADMIN'}
    await member_model.add(board_id, body.user_id, body.role, db)
    return {'status': True}


async def update_member_role(board_id: int, target_user_id: int, body,
                             request: Request, db: AsyncSession):
    err = await _require_role(board_id, request, 'admin', db)
    if err:
        return err
    target_role = await member_model.get_role(board_id, target_user_id, db)
    if not target_role:
        return {'status': False, 'message': 'MEMBER_NOT_FOUND'}
    new_role = body.role
    if target_role == 'admin' and new_role != 'admin':
        if await member_model.count_admins(board_id, db) <= 1:
            return {'status': False, 'message': 'LAST_ADMIN'}
    await member_model.update_role(board_id, target_user_id, new_role, db)
    return {'status': True}


async def remove_member(board_id: int, target_user_id: int, request: Request,
                        db: AsyncSession):
    if not await board_model.find_by_id(board_id, db):
        return {'status': False, 'message': 'BOARD_NOT_FOUND'}
    user_id = request.state.payload.get('user_id')
    # 남을 제거하려면 admin, 본인 탈퇴(leave)는 멤버 누구나 가능
    if user_id != target_user_id:
        role = await member_model.get_role(board_id, user_id, db)
        if not member_model.has_at_least(role, 'admin'):
            return {'status': False, 'message': 'PERMISSION_DENIED'}
    target_role = await member_model.get_role(board_id, target_user_id, db)
    if not target_role:
        return {'status': True}  # 멱등 — 이미 멤버가 아님
    if target_role == 'admin' and await member_model.count_admins(board_id, db) <= 1:
        return {'status': False, 'message': 'LAST_ADMIN'}
    await member_model.remove(board_id, target_user_id, db)
    return {'status': True}
