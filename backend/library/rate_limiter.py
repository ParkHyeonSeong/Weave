"""Rate limiting -- slowapi 기반"""
from fastapi import Request
from slowapi import Limiter

from library.client_ip import get_client_ip

# key_func: 신뢰 프록시 뒤에서만 포워딩 헤더를 신뢰해 IP를 산출(CFG-01). 헤더 위조로
# 레이트리밋을 우회하지 못하게 한다.
limiter = Limiter(key_func=get_client_ip, default_limits=["60/minute"])


def user_or_ip_key(request: Request) -> str:
    """인증된 요청은 계정(user_id)별로, 아니면 IP별로 제한한다.

    LLM 비용·집계 부하 같은 비용 엔드포인트는 계정 기준이라야 공유 NAT 뒤의 정상
    사용자를 막지 않으면서 단일 계정의 남용을 차단할 수 있다(SEC-11).
    """
    payload = getattr(request.state, 'payload', None) or {}
    user_id = payload.get('user_id')
    return f"user:{user_id}" if user_id else get_client_ip(request)
