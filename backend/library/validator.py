import jwt
from fastapi import Request
from config import JWT_SECRET_KEY, JWT_ALGORITHM, COOKIE_NAME


class UnAuthorizedException(Exception):
    def __init__(self, status: bool, message: str):
        self.status = status
        self.message = message


def validate_login(request: Request):
    """쿠키에서 JWT 추출 및 검증"""
    try:
        token = request.cookies.get(COOKIE_NAME, '')
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except Exception:
        payload = {'user_id': 0}
    return payload


def require_login(request: Request):
    """로그인 필수 의존성"""
    if not request.state.payload.get('user_id'):
        raise UnAuthorizedException(status=False, message='NEED_LOGIN')


def require_admin(request: Request):
    """관리자 전용 의존성"""
    require_login(request)
    if request.state.payload.get('role') != 'admin':
        raise UnAuthorizedException(status=False, message='ADMIN_REQUIRED')
