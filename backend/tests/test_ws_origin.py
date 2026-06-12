"""SEC-39: WebSocket Origin 검증(cross-site WebSocket hijacking 차단).

WS는 쿠키 JWT로 인증하는데 SameSite=lax에만 의존하지 않고 서버가 Origin을 직접 검사한다.
- 동일 출처(Origin 권한부 == Host): 허용 (리버스 프록시 뒤 prod 동일 출처 포함)
- 명시 목록/dev 루프백: 허용
- 그 외(타 사이트·LAN·Origin 부재): 거절
"""
from config import DEBUG
from library.origins import is_allowed_origin, reject_ws_if_forbidden_origin


# ── 정책(is_allowed_origin) ────────────────────────────────────────────────

def test_same_origin_allowed():
    # prod: 프론트와 API가 nginx 뒤 동일 출처
    assert is_allowed_origin('https://weave.example.com', 'weave.example.com') is True


def test_cross_site_origin_rejected():
    assert is_allowed_origin('http://evil.com', 'weave.example.com') is False


def test_suffix_bypass_rejected():
    # fullmatch라 localhost.evil.com 같은 접미사 우회를 차단
    assert is_allowed_origin('http://localhost.evil.com', 'localhost:8000') is False


def test_lan_origin_rejected():
    # H-2: 사설 LAN 대역은 더 이상 신뢰하지 않는다(이전엔 credentials와 함께 허용됐음)
    assert is_allowed_origin('http://192.168.1.50:3000', 'localhost:8000') is False
    assert is_allowed_origin('http://10.0.0.5', 'localhost:8000') is False


def test_missing_origin_rejected():
    assert is_allowed_origin('', 'localhost:8000') is False


def test_non_http_scheme_not_treated_as_same_origin():
    # 'ftp://host'가 Host와 authority는 같아 보여도 동일 출처로 인정하지 않는다(스킴 검증)
    assert is_allowed_origin('ftp://weave.example.com', 'weave.example.com') is False


def test_loopback_any_port_allowed_in_debug():
    if not DEBUG:
        return  # dev 전용 루프백 허용 — prod에선 명시 목록만
    assert is_allowed_origin('http://localhost:10000', 'localhost:8000') is True
    assert is_allowed_origin('http://127.0.0.1:3000', 'localhost:8000') is True


# ── 핸드셰이크 거절 헬퍼(reject_ws_if_forbidden_origin) ─────────────────────

class _FakeWS:
    def __init__(self, headers):
        self.headers = headers
        self.closed_code = None

    async def close(self, code=1000, reason=''):
        self.closed_code = code


async def test_reject_helper_closes_forbidden_origin():
    # 헬퍼가 close(4403)를 호출하는지 검증한다. 단, accept 전 close라 실제 uvicorn에선
    # 클라이언트가 close code 4403이 아닌 HTTP 403을 받는다(라이브로 확인됨).
    ws = _FakeWS({'origin': 'http://evil.com', 'host': 'weave.example.com'})
    assert await reject_ws_if_forbidden_origin(ws) is True
    assert ws.closed_code == 4403


async def test_reject_helper_allows_same_origin():
    ws = _FakeWS({'origin': 'https://weave.example.com', 'host': 'weave.example.com'})
    assert await reject_ws_if_forbidden_origin(ws) is False
    assert ws.closed_code is None
