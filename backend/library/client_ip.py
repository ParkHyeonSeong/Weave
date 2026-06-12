"""신뢰 프록시 뒤에서 실제 클라이언트 IP 산출 (CFG-01).

reverse proxy(nginx) 뒤에서만 X-Real-IP/X-Forwarded-For를 신뢰한다. 직접 피어가
신뢰 프록시 목록(config.TRUSTED_PROXY_NETWORKS)에 없으면 클라이언트가 보낸 포워딩
헤더는 위조로 간주하고 무시한다 — 그러지 않으면 헤더 한 줄(X-Forwarded-For: 1.2.3.4)로
IP 기반 레이트리밋(로그인 5/분 브루트포스 방어 등)을 우회할 수 있다.

레이트리밋 key_func와 로그인 로깅이 모두 이 함수를 공유해 IP 산출 규칙을 단일화한다.
"""
import ipaddress

from fastapi import Request

from config import TRUSTED_PROXY_NETWORKS


def _peer_is_trusted(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(ip in net for net in TRUSTED_PROXY_NETWORKS)


def get_client_ip(request: Request) -> str:
    """직접 피어가 신뢰 프록시일 때만 포워딩 헤더를 신뢰해 실제 클라이언트 IP를 반환."""
    peer = request.client.host if request.client else ''
    if peer and _peer_is_trusted(peer):
        # nginx가 $remote_addr로 채우는 X-Real-IP를 우선 신뢰(가장 명확).
        real_ip = request.headers.get('X-Real-IP')
        if real_ip:
            return real_ip.strip()
        # 폴백: 신뢰 프록시가 $proxy_add_x_forwarded_for로 가장 오른쪽에 덧붙인 실제 피어.
        forwarded = request.headers.get('X-Forwarded-For')
        if forwarded:
            return forwarded.split(',')[-1].strip()
    return peer or '127.0.0.1'
