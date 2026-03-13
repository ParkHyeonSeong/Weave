"""Rate limiting -- slowapi 기반"""
from fastapi import Request
from slowapi import Limiter


def _get_real_ip(request: Request) -> str:
    """프록시 뒤에서 실제 클라이언트 IP 추출"""
    forwarded = request.headers.get('X-Forwarded-For')
    if forwarded:
        return forwarded.split(',')[0].strip()
    real_ip = request.headers.get('X-Real-IP')
    if real_ip:
        return real_ip
    return request.client.host if request.client else '127.0.0.1'


limiter = Limiter(key_func=_get_real_ip, default_limits=["60/minute"])
