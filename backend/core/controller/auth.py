import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from fastapi import Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from config import (
    JWT_SECRET_KEY, JWT_ALGORITHM, JWT_EXPIRE_HOURS,
    COOKIE_NAME, COOKIE_SECURE, COOKIE_SAMESITE, COOKIE_HTTPONLY,
)
from core.model import user as user_model
from core.model import workspace as workspace_model


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get('X-Forwarded-For')
    if forwarded:
        return forwarded.split(',')[0].strip()
    real_ip = request.headers.get('X-Real-IP')
    if real_ip:
        return real_ip
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


def _set_auth_cookie(response: Response, token: str):
    """응답에 인증 쿠키 설정"""
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=JWT_EXPIRE_HOURS * 3600,
        httponly=COOKIE_HTTPONLY,
        samesite=COOKIE_SAMESITE,
        secure=COOKIE_SECURE,
        path="/",
    )


def _clear_auth_cookie(response: Response):
    """인증 쿠키 삭제"""
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        samesite=COOKIE_SAMESITE,
        secure=COOKIE_SECURE,
    )


async def register(body, request: Request, response: Response, db: AsyncSession):
    """회원가입"""
    # 초기화 여부 확인
    settings = await workspace_model.get_settings(db)
    if not settings:
        return {'status': False, 'message': 'NOT_INITIALIZED'}

    existing = await user_model.find_by_email(body.email, db)
    if existing:
        return {'status': False, 'message': 'EMAIL_ALREADY_EXISTS'}

    password_hash = bcrypt.hashpw(body.password.encode('utf-8'), bcrypt.gensalt())

    # private 모드: pending 상태로 생성, 승인 대기
    if settings['registration_policy'] == 'private':
        await user_model.create(body.email, password_hash, body.username, db, status='pending')
        return {'status': True, 'pending': True, 'message': 'ACCOUNT_PENDING'}

    # public 모드: active 상태로 생성, 즉시 로그인
    user_id = await user_model.create(body.email, password_hash, body.username, db)
    token = _create_token(user_id, body.email, body.username, 'member')
    _set_auth_cookie(response, token)
    return {
        'status': True,
        'profile': {
            'user_id': user_id,
            'email': body.email,
            'username': body.username,
            'role': 'member',
            # 같은 브라우저에서 계정 전환 시 이전 사용자의 아바타가 남지 않도록 명시
            'avatar_url': None,
            'avatar_color': None,
        },
    }


async def login(body, request: Request, response: Response, db: AsyncSession):
    """로그인"""
    user = await user_model.find_by_email(body.email, db)
    if not user:
        return {'status': False, 'message': 'INVALID_CREDENTIALS'}

    stored_password = user['password']
    if isinstance(stored_password, memoryview):
        stored_password = bytes(stored_password)

    if not bcrypt.checkpw(body.password.encode('utf-8'), stored_password):
        return {'status': False, 'message': 'INVALID_CREDENTIALS'}

    # 계정 상태 확인
    if user.get('status') == 'pending':
        return {'status': False, 'message': 'ACCOUNT_PENDING'}
    if user.get('status') == 'rejected':
        return {'status': False, 'message': 'ACCOUNT_REJECTED'}
    if user.get('status') == 'inactive':
        return {'status': False, 'message': 'ACCOUNT_INACTIVE'}

    ip = _get_client_ip(request)
    await user_model.update_login(user['user_id'], ip, db)

    role = user.get('role', 'member')
    token = _create_token(user['user_id'], user['email'], user['username'], role)
    _set_auth_cookie(response, token)

    profile = {
        'user_id': user['user_id'],
        'email': user['email'],
        'username': user['username'],
        'role': role,
        'avatar_url': user.get('avatar_url'),
        'avatar_color': user.get('avatar_color'),
    }

    # 비밀번호 변경 강제 플래그
    if user.get('must_change_password'):
        profile['must_change_password'] = True

    return {'status': True, 'profile': profile}


async def me(request: Request):
    """현재 인증 사용자 프로필 반환"""
    payload = request.state.payload
    return {
        'status': True,
        'profile': {
            'user_id': payload.get('user_id'),
            'email': payload.get('email'),
            'username': payload.get('username'),
            'role': payload.get('role'),
        },
    }


async def logout(response: Response):
    """로그아웃 - 쿠키 삭제"""
    _clear_auth_cookie(response)
    return {'status': True}
