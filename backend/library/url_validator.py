"""URL 유효성 검증 -- SSRF 방지"""
import ipaddress
import socket
from urllib.parse import urlparse

# Docker 내부 서비스 및 클라우드 메타데이터 호스트명 차단
BLOCKED_HOSTNAMES = {
    'localhost', 'db', 'backend', 'frontend', 'nginx',
    'weave-db', 'weave-backend', 'weave-frontend', 'weave-nginx',
    'metadata.google.internal',
}


def _is_private_ip(ip_str: str) -> bool:
    """사설/루프백/링크로컬 IP 여부 확인"""
    try:
        addr = ipaddress.ip_address(ip_str)
        return (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_reserved
            or addr.is_multicast
            or addr.is_unspecified
        )
    except ValueError:
        return True  # 파싱 실패 시 차단


def validate_url_for_ssrf(url: str) -> str | None:
    """
    URL SSRF 검증. 위험하면 에러 메시지 반환, 안전하면 None 반환.
    """
    parsed = urlparse(url)
    hostname = parsed.hostname

    if not hostname:
        return 'Invalid URL'

    if hostname.lower() in BLOCKED_HOSTNAMES:
        return 'Blocked hostname'

    # DNS 해석 후 IP 검증
    try:
        addr_infos = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except socket.gaierror:
        return 'DNS resolution failed'

    if not addr_infos:
        return 'DNS resolution returned no results'

    for _, _, _, _, sockaddr in addr_infos:
        ip_str = sockaddr[0]
        if _is_private_ip(ip_str):
            return 'URL resolves to a private/internal IP'

    return None
