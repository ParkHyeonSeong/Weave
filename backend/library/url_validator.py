"""URL 유효성 검증 -- SSRF 방지"""
import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

# Docker 내부 서비스 및 클라우드 메타데이터 호스트명 차단
BLOCKED_HOSTNAMES = {
    'localhost', 'db', 'backend', 'frontend', 'nginx',
    'weave-db', 'weave-backend', 'weave-frontend', 'weave-nginx',
    'metadata.google.internal',
}


def _is_blocked_ip(ip_str: str) -> bool:
    """연결 금지 IP 여부. 글로벌 라우팅 가능한 공인 IP만 허용한다.

    addr.is_global은 사설(10/8 등)·루프백·링크로컬·CGNAT(100.64/10·RFC6598)·예약·
    멀티캐스트·특수용도 대역을 모두 비글로벌로 처리하므로, is_private 등을 개별 OR하는
    denylist보다 누락이 적다(예: CGNAT는 is_private/is_reserved 모두 False라 빠져나간다)."""
    try:
        return not ipaddress.ip_address(ip_str).is_global
    except ValueError:
        return True  # 파싱 실패 시 차단


async def resolve_validated_ip(url: str) -> tuple[str | None, str | None]:
    """SSRF 검증 + 검증된 IP 반환. 안전하면 (ip, None), 위험하면 (None, error_message).

    호출부가 반환된 IP로 *직접* 연결하면, 검증 시점의 DNS 결과와 실제 연결 시점의
    DNS 결과가 달라지는 DNS 리바인딩(TOCTOU)을 차단할 수 있다. 모든 해석 IP가 공인
    대역이어야 통과하며, 연결용으로는 첫 번째 IP를 반환한다.

    DNS 조회(getaddrinfo)는 블로킹이므로 스레드풀에서 실행해 이벤트 루프를 막지 않는다."""
    parsed = urlparse(url)
    hostname = parsed.hostname

    if not hostname:
        return None, 'Invalid URL'

    if hostname.lower() in BLOCKED_HOSTNAMES:
        return None, 'Blocked hostname'

    try:
        addr_infos = await asyncio.get_running_loop().run_in_executor(
            None, socket.getaddrinfo, hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM
        )
    except socket.gaierror:
        return None, 'DNS resolution failed'

    if not addr_infos:
        return None, 'DNS resolution returned no results'

    first_ip = None
    for _, _, _, _, sockaddr in addr_infos:
        ip_str = sockaddr[0]
        if _is_blocked_ip(ip_str):
            return None, 'URL resolves to a private/internal IP'
        if first_ip is None:
            first_ip = ip_str

    return first_ip, None


async def validate_url_for_ssrf(url: str) -> str | None:
    """URL SSRF 검증. 위험하면 에러 메시지, 안전하면 None 반환."""
    _ip, error = await resolve_validated_ip(url)
    return error


async def validate_push_endpoint(url: str) -> str | None:
    """Web Push 구독 endpoint 검증 — https 공개 호스트만 허용(SSRF 방지).

    endpoint는 사용자 입력이며 이후 pywebpush가 서버측에서 POST하므로, http/내부망/
    메타데이터 호스트를 차단한다. 위험하면 에러 메시지, 안전하면 None을 반환한다."""
    parsed = urlparse(url)
    if parsed.scheme != 'https':
        return 'Push endpoint must use https'
    return await validate_url_for_ssrf(url)
