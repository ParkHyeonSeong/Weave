"""SEC-32: 전역 요청 본문 크기 상한 미들웨어.

Content-Length가 상한을 넘으면 본문 파싱 전에 413으로 거절한다. nginx를 우회한
backend 직접 접근에서도 대형 본문으로 인한 메모리 고갈을 막는 방어선이다.
"""
import httpx
import pytest
from httpx import ASGITransport

import main


@pytest.fixture
async def raw_client():
    # 인증 불필요 — 미들웨어는 라우팅 전에 실행된다.
    async with httpx.AsyncClient(transport=ASGITransport(app=main.app),
                                 base_url="http://test") as c:
        yield c


async def test_oversized_body_rejected_413(raw_client, monkeypatch):
    monkeypatch.setattr(main, "MAX_REQUEST_BODY_BYTES", 8)
    res = await raw_client.post("/api/health", content=b"0123456789abcdef")  # 16B > 8
    assert res.status_code == 413
    assert res.json()["message"] == "REQUEST_TOO_LARGE"


async def test_body_under_limit_not_blocked(raw_client, monkeypatch):
    monkeypatch.setattr(main, "MAX_REQUEST_BODY_BYTES", 1000)
    res = await raw_client.post("/api/health", content=b"small")
    assert res.status_code != 413


async def test_limit_disabled_when_zero(raw_client, monkeypatch):
    monkeypatch.setattr(main, "MAX_REQUEST_BODY_BYTES", 0)
    res = await raw_client.post("/api/health", content=b"0123456789")
    assert res.status_code != 413
