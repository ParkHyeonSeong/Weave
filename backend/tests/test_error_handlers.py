import json
from types import SimpleNamespace

import httpx
import pytest
from httpx import ASGITransport

import main
from library import validator


@pytest.fixture
async def client():
    transport = ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def _req():
    # global_exception_handler reads request.url.path for logging; others ignore it.
    return SimpleNamespace(url=SimpleNamespace(path="/api/test"))


async def test_oversize_request_returns_unified_413_body(client):
    # Content-Length over the cap is rejected by the limit_body_size middleware.
    huge = str(main.MAX_REQUEST_BODY_BYTES + 1)
    resp = await client.post(
        "/api/auth/login",
        headers={"content-length": huge, "content-type": "application/json"},
        content=b"{}",
    )
    assert resp.status_code == 413
    assert resp.json() == {
        "status": False, "message": "REQUEST_TOO_LARGE", "code": "REQUEST_TOO_LARGE",
        "category": "validation", "retryable": False,
    }


async def test_rate_limit_handler_unified_body():
    resp = await main.rate_limit_handler(_req(), None)  # handler ignores exc
    assert resp.status_code == 429
    body = json.loads(resp.body)
    assert body["message"] == "RATE_LIMIT_EXCEEDED"   # legacy dual-emit
    assert body["code"] == "RATE_LIMIT_EXCEEDED"
    assert body["category"] == "rate_limited"
    assert body["retryable"] is True


async def test_unauthorized_handler_need_login_is_auth():
    exc = validator.UnAuthorizedException(status=False, message="NEED_LOGIN")
    resp = await main.unauthorized_handler(_req(), exc)
    assert resp.status_code == 401
    body = json.loads(resp.body)
    assert body["code"] == "NEED_LOGIN"
    assert body["category"] == "auth"
    assert body["retryable"] is False


async def test_unauthorized_handler_admin_required_is_forbidden():
    exc = validator.UnAuthorizedException(status=False, message="ADMIN_REQUIRED")
    resp = await main.unauthorized_handler(_req(), exc)
    assert resp.status_code == 401
    body = json.loads(resp.body)
    assert body["code"] == "ADMIN_REQUIRED"
    assert body["category"] == "forbidden"


async def test_global_exception_handler_unified_500():
    resp = await main.global_exception_handler(_req(), Exception("boom"))
    assert resp.status_code == 500
    body = json.loads(resp.body)
    assert body["code"] == "INTERNAL_SERVER_ERROR"
    assert body["category"] == "server"
    assert body["retryable"] is True
