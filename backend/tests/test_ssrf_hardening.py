"""SEC-16: SSRF 하드닝.

- validate_push_endpoint: 푸시 구독 endpoint는 https 공개 호스트만 (pywebpush SSRF 차단)
- resolve_validated_ip: 내부/차단 호스트 거부 + 검증된 IP 반환(url_meta DNS 리바인딩 핀용)
- push subscribe 컨트롤러가 내부/http endpoint를 거부

(공개 호스트 해석은 실DNS가 필요해 단위테스트에서 제외 — url_meta IP핀 fetch는 example.com
으로 수동검증함: 검증된 IP 직접연결 + Host/SNI 유지로 200/cert-ok.)
"""
import socket
from types import SimpleNamespace

import bcrypt
from sqlalchemy import text

from library.url_validator import (
    resolve_validated_ip, validate_push_endpoint, validate_url_for_ssrf,
)
from core.controller import push as push_controller


def _req(uid):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': uid}))


# ── validate_push_endpoint ─────────────────────────────────────────────────

async def test_push_endpoint_rejects_http():
    # http는 거부(https 공개 호스트만 허용)
    assert await validate_push_endpoint('http://fcm.googleapis.com/send/x') is not None


async def test_push_endpoint_rejects_internal_hostnames():
    assert await validate_push_endpoint('https://localhost/x') is not None
    assert await validate_push_endpoint('https://metadata.google.internal/x') is not None
    assert await validate_push_endpoint('https://db/x') is not None


# ── resolve_validated_ip ───────────────────────────────────────────────────

async def test_resolve_validated_ip_blocks_internal_hostnames():
    ip, err = await resolve_validated_ip('https://localhost/x')
    assert ip is None and err == 'Blocked hostname'
    ip, err = await resolve_validated_ip('http://backend:8000/x')
    assert ip is None and err == 'Blocked hostname'


async def test_resolve_validated_ip_invalid_url():
    ip, err = await resolve_validated_ip('not-a-url')
    assert ip is None and err is not None


async def test_resolve_blocks_cgnat(monkeypatch):
    # CGNAT(100.64.0.0/10)는 is_private/is_reserved 모두 False라 denylist를 빠져나가지만
    # is_global=False이므로 차단돼야 한다(DNS 리바인딩으로 CGNAT 내부주소를 노릴 때 방어).
    monkeypatch.setattr(socket, 'getaddrinfo',
                        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 0, '', ('100.64.0.1', 0))])
    ip, err = await resolve_validated_ip('https://rebind.example/x')
    assert ip is None and err is not None


async def test_validate_url_for_ssrf_wrapper_blocks_internal():
    assert await validate_url_for_ssrf('https://localhost/x') == 'Blocked hostname'


# ── push subscribe 컨트롤러 ────────────────────────────────────────────────

async def test_subscribe_rejects_internal_endpoint(db_session):
    body = SimpleNamespace(endpoint='https://localhost/push', p256dh='x', auth='y')
    res = await push_controller.subscribe(body, _req(1), db_session)
    assert res['status'] is False
    assert res['message'] == 'INVALID_ENDPOINT'


async def test_subscribe_rejects_metadata_http_endpoint(db_session):
    body = SimpleNamespace(endpoint='http://169.254.169.254/latest/meta-data/', p256dh='x', auth='y')
    res = await push_controller.subscribe(body, _req(1), db_session)
    assert res['status'] is False
    assert res['message'] == 'INVALID_ENDPOINT'


async def test_subscribe_accepts_valid_endpoint(db_session, monkeypatch):
    # 검증 통과 시 정상 저장되는지(전부 거부하는 회귀 방지) — DNS 의존 없이 검증만 우회
    async def _ok(_u):
        return None
    monkeypatch.setattr(push_controller, 'validate_push_endpoint', _ok)
    pw = bcrypt.hashpw(b'x', bcrypt.gensalt())
    row = await db_session.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES ('push@t.local', :p, 'pushu', 'active', 'member') RETURNING user_id
    """), {'p': pw})
    uid = row.scalar_one()
    body = SimpleNamespace(endpoint='https://fcm.googleapis.com/send/abc', p256dh='x', auth='y')
    res = await push_controller.subscribe(body, _req(uid), db_session)
    assert res['status'] is True
