import secrets
import bcrypt
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import user as user_model


async def create_user(body, request: Request, db: AsyncSession):
    """관리자가 수동으로 사용자 생성"""
    existing = await user_model.find_by_email(body.email, db)
    if existing:
        return {'status': False, 'message': 'EMAIL_ALREADY_EXISTS'}

    password_hash = bcrypt.hashpw(body.password.encode('utf-8'), bcrypt.gensalt())
    user_id = await user_model.create(body.email, password_hash, body.username, db)

    if body.role == 'admin':
        await user_model.update_role(user_id, 'admin', db)

    return {'status': True, 'user_id': user_id}


async def list_users(request: Request, db: AsyncSession):
    """전체 사용자 목록 조회"""
    users = await user_model.find_all(db)
    return {'status': True, 'users': users}


async def update_user_role(user_id: int, body, request: Request, db: AsyncSession):
    """사용자 역할 변경"""
    admin_id = request.state.payload.get('user_id')

    # 자기 자신의 역할은 변경 불가
    if user_id == admin_id:
        return {'status': False, 'message': 'CANNOT_CHANGE_OWN_ROLE'}

    target = await user_model.find_by_id(user_id, db)
    if not target:
        return {'status': False, 'message': 'USER_NOT_FOUND'}

    await user_model.update_role(user_id, body.role, db)
    return {'status': True}


async def update_user_status(user_id: int, body, request: Request, db: AsyncSession):
    """사용자 상태 변경 (승인/거부)"""
    admin_id = request.state.payload.get('user_id')

    # 자기 자신의 상태는 변경 불가
    if user_id == admin_id:
        return {'status': False, 'message': 'CANNOT_CHANGE_OWN_STATUS'}

    target = await user_model.find_by_id(user_id, db)
    if not target:
        return {'status': False, 'message': 'USER_NOT_FOUND'}

    await user_model.update_status(user_id, body.status, db)
    return {'status': True}


async def reset_user_password(user_id: int, body, request: Request, db: AsyncSession):
    """사용자 비밀번호 초기화"""
    admin_id = request.state.payload.get('user_id')

    # 자기 자신의 비밀번호는 초기화 불가
    if user_id == admin_id:
        return {'status': False, 'message': 'CANNOT_RESET_OWN_PASSWORD'}

    target = await user_model.find_by_id(user_id, db)
    if not target:
        return {'status': False, 'message': 'USER_NOT_FOUND'}

    # 비밀번호 생성 (미지정 시 자동 생성)
    plain_password = body.new_password if body.new_password else secrets.token_urlsafe(9)
    password_hash = bcrypt.hashpw(plain_password.encode('utf-8'), bcrypt.gensalt())

    await user_model.update_password(user_id, password_hash, db)
    await user_model.set_must_change_password(user_id, True, db)

    return {'status': True, 'temporary_password': plain_password}
