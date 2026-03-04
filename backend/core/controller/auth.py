import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from fastapi import Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from config import JWT_SECRET_KEY, JWT_ALGORITHM, JWT_EXPIRE_HOURS
from core.model import user as user_model
from core.model import workspace as workspace_model


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get('X-Forwarded-For')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.client.host if request.client else '0.0.0.0'


def _create_token(user_id: int, email: str, username: str, role: str = 'member') -> str:
    payload = {
        'user_id': user_id,
        'email': email,
        'username': username,
        'role': role,
        'exp': datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


async def register(body, request: Request, db: AsyncSession):
    """회원가입"""
    # 초기화 여부 확인
    settings = await workspace_model.get_settings(db)
    if not settings:
        return {'status': False, 'message': 'NOT_INITIALIZED'}

    # private 모드에서는 회원가입 차단
    if settings['registration_policy'] == 'private':
        return {'status': False, 'message': 'REGISTRATION_DISABLED'}

    existing = await user_model.find_by_email(body.email, db)
    if existing:
        return {'status': False, 'message': 'EMAIL_ALREADY_EXISTS'}

    password_hash = bcrypt.hashpw(body.password.encode('utf-8'), bcrypt.gensalt())
    user_id = await user_model.create(body.email, password_hash, body.username, db)

    token = _create_token(user_id, body.email, body.username, 'member')
    return {'status': True, 'x_token': token}


async def login(body, request: Request, db: AsyncSession):
    """로그인"""
    user = await user_model.find_by_email(body.email, db)
    if not user:
        return {'status': False, 'message': 'INVALID_CREDENTIALS'}

    stored_password = user['password']
    if isinstance(stored_password, memoryview):
        stored_password = bytes(stored_password)

    if not bcrypt.checkpw(body.password.encode('utf-8'), stored_password):
        return {'status': False, 'message': 'INVALID_CREDENTIALS'}

    ip = _get_client_ip(request)
    await user_model.update_login(user['user_id'], ip, db)

    token = _create_token(user['user_id'], user['email'], user['username'], user.get('role', 'member'))
    return {'status': True, 'x_token': token}


async def health_check(request: Request):
    """인증 상태 확인"""
    payload = request.state.payload
    return {
        'status': True,
        'user_id': payload.get('user_id'),
        'email': payload.get('email'),
        'username': payload.get('username'),
    }
