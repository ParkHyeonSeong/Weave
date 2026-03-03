import jwt
from fastapi import Request
from config import JWT_SECRET_KEY, JWT_ALGORITHM


class UnAuthorizedException(Exception):
    def __init__(self, status: bool, message: str):
        self.status = status
        self.message = message


def validate_login(request: Request):
    """Authorization 헤더에서 JWT 추출 및 검증"""
    try:
        auth = request.headers.get('Authorization', '').split(' ')
        token = auth[1] if auth[0] == 'Bearer' else ''
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except Exception:
        payload = {'user_id': 0}
    return payload


def require_login(request: Request):
    """로그인 필수 의존성"""
    if not request.state.payload.get('user_id'):
        raise UnAuthorizedException(status=False, message='NEED_LOGIN')
