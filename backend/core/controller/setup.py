import bcrypt
from fastapi import Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from core.controller.auth import _create_token, _set_auth_cookie
from core.model import workspace as workspace_model
from core.model import user as user_model


async def check_initialized(db: AsyncSession):
    """초기화 상태 확인"""
    settings = await workspace_model.get_settings(db)
    if settings:
        return {
            'status': True,
            'initialized': True,
            'workspace_name': settings['workspace_name'],
            'registration_policy': settings['registration_policy'],
        }
    return {'status': True, 'initialized': False}


async def initialize(body, request: Request, response: Response, db: AsyncSession):
    """초기 설정 실행 (최초 1회)"""
    # 이미 초기화된 경우 차단
    existing = await workspace_model.get_settings(db)
    if existing:
        return {'status': False, 'message': 'ALREADY_INITIALIZED'}

    # 이메일 중복 체크
    existing_user = await user_model.find_by_email(body.email, db)
    if existing_user:
        return {'status': False, 'message': 'EMAIL_ALREADY_EXISTS'}

    # 관리자 계정 생성
    password_hash = bcrypt.hashpw(body.password.encode('utf-8'), bcrypt.gensalt())
    user_id = await user_model.create(body.email, password_hash, body.username, db)

    # admin 역할 부여
    await user_model.update_role(user_id, 'admin', db)

    # 워크스페이스 설정 저장
    await workspace_model.create_settings(
        workspace_name=body.workspace_name,
        registration_policy=body.registration_policy,
        admin_user_id=user_id,
        db=db,
    )

    # 쿠키 발급
    token = _create_token(user_id, body.email, body.username, 'admin')
    _set_auth_cookie(response, token)

    return {
        'status': True,
        'profile': {
            'user_id': user_id,
            'email': body.email,
            'username': body.username,
            'role': 'admin',
        },
    }
