import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from config import JWT_SECRET_KEY, JWT_ALGORITHM, JWT_EXPIRE_HOURS
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


async def initialize(body, request: Request, db: AsyncSession):
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

    # JWT 발급
    payload = {
        'user_id': user_id,
        'email': body.email,
        'username': body.username,
        'role': 'admin',
        'exp': datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)

    return {'status': True, 'x_token': token}
