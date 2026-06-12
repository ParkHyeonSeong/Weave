"""CFG-01: 신뢰 프록시 뒤에서만 포워딩 헤더를 신뢰하는 client IP 산출.

신뢰하지 않는 피어가 보낸 X-Forwarded-For/X-Real-IP는 위조로 보고 무시해야,
헤더 한 줄로 IP 기반 레이트리밋을 우회하지 못한다.
"""
from types import SimpleNamespace

from library.client_ip import get_client_ip


def _req(peer, headers=None):
    return SimpleNamespace(
        client=SimpleNamespace(host=peer) if peer else None,
        headers=headers or {},
    )


def test_untrusted_peer_ignores_spoofed_headers():
    # 공개망 피어가 직접 접속 + XFF/X-Real-IP 위조 → 헤더 무시, 실제 피어 IP 사용
    req = _req('203.0.113.5', {
        'X-Forwarded-For': '1.2.3.4',
        'X-Real-IP': '5.6.7.8',
    })
    assert get_client_ip(req) == '203.0.113.5'


def test_trusted_peer_uses_x_real_ip():
    # docker 사설망 nginx(172.18.x) 경유 → nginx가 채운 X-Real-IP 신뢰
    req = _req('172.18.0.2', {'X-Real-IP': '198.51.100.7'})
    assert get_client_ip(req) == '198.51.100.7'


def test_trusted_peer_falls_back_to_rightmost_xff():
    # X-Real-IP 부재 시 신뢰 프록시가 덧붙인 가장 오른쪽 XFF(실제 피어) 사용
    req = _req('10.0.0.9', {'X-Forwarded-For': '1.2.3.4, 5.6.7.8, 198.51.100.9'})
    assert get_client_ip(req) == '198.51.100.9'


def test_trusted_peer_no_forward_headers_uses_peer():
    req = _req('127.0.0.1', {})
    assert get_client_ip(req) == '127.0.0.1'


def test_no_client_defaults_safely():
    assert get_client_ip(_req(None, {})) == '127.0.0.1'


def test_loopback_is_trusted():
    # 루프백도 신뢰 범위(개발/동일 호스트 프록시)
    req = _req('127.0.0.1', {'X-Real-IP': '198.51.100.1'})
    assert get_client_ip(req) == '198.51.100.1'
