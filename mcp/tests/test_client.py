import httpx
import pytest
import respx

from weave_mcp.client import WeaveClient, WeaveAuthError
from weave_mcp.config import Settings


def make_client():
    return WeaveClient(
        settings=Settings(base_url="http://test", email="bot@x.com", password="pw")
    )


@respx.mock
async def test_call_logs_in_on_401_then_retries():
    login = respx.post("http://test/api/auth/login").mock(
        return_value=httpx.Response(
            200,
            json={"status": True},
            headers={"set-cookie": "weave_token=abc; Path=/"},
        )
    )
    target = respx.get("http://test/api/branches").mock(
        side_effect=[
            httpx.Response(401, json={"message": "NEED_LOGIN"}),
            httpx.Response(200, json=[{"id": 1}]),
        ]
    )
    c = make_client()
    resp = await c.call("GET", "/api/branches")
    await c.aclose()

    assert resp.status_code == 200
    assert login.call_count == 1
    assert target.call_count == 2
    # retry carried the cookie obtained from login
    assert "weave_token=abc" in target.calls[1].request.headers.get("cookie", "")


@respx.mock
async def test_call_reuses_cookie_without_relogin():
    login = respx.post("http://test/api/auth/login").mock(
        return_value=httpx.Response(
            200,
            json={"status": True},
            headers={"set-cookie": "weave_token=abc; Path=/"},
        )
    )
    respx.get("http://test/api/branches").mock(
        side_effect=[
            httpx.Response(401),            # first call -> triggers login
            httpx.Response(200, json=[]),   # retry of first call
            httpx.Response(200, json=[]),   # second call -> no 401, no relogin
        ]
    )
    c = make_client()
    await c.call("GET", "/api/branches")
    await c.call("GET", "/api/branches")
    await c.aclose()

    assert login.call_count == 1


@respx.mock
async def test_login_bad_credentials_http200_raises_auth_error():
    # Weave returns HTTP 200 with {"status": false} for bad credentials (no cookie set).
    # The status code alone would look like success — _login must check the body.
    respx.post("http://test/api/auth/login").mock(
        return_value=httpx.Response(
            200, json={"status": False, "message": "INVALID_CREDENTIALS"}
        )
    )
    respx.get("http://test/api/branches").mock(return_value=httpx.Response(401))
    c = make_client()
    with pytest.raises(WeaveAuthError):
        await c.call("GET", "/api/branches")
    await c.aclose()


@respx.mock
async def test_login_http_error_raises_auth_error():
    respx.post("http://test/api/auth/login").mock(return_value=httpx.Response(500))
    respx.get("http://test/api/branches").mock(return_value=httpx.Response(401))
    c = make_client()
    with pytest.raises(WeaveAuthError):
        await c.call("GET", "/api/branches")
    await c.aclose()


@respx.mock
async def test_call_json_success_returns_parsed_body():
    respx.get("http://test/api/branches").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "name": "Core"}])
    )
    c = make_client()
    result = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert result == [{"id": 1, "name": "Core"}]


@respx.mock
async def test_call_json_http_error_returns_error_dict():
    respx.get("http://test/api/branches/9/tasks/5").mock(
        return_value=httpx.Response(404, json={"message": "NOT_FOUND"})
    )
    c = make_client()
    result = await c.call_json("GET", "/api/branches/9/tasks/5")
    await c.aclose()
    assert result["error"] == 404
    assert result["detail"] == {"message": "NOT_FOUND"}


@respx.mock
async def test_call_json_auth_error_returns_error_dict():
    respx.post("http://test/api/auth/login").mock(
        return_value=httpx.Response(200, json={"status": False, "message": "INVALID_CREDENTIALS"})
    )
    respx.get("http://test/api/branches").mock(return_value=httpx.Response(401))
    c = make_client()
    result = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert result["error"] == "auth"


@respx.mock
async def test_call_json_network_error_returns_error_dict():
    respx.get("http://test/api/branches").mock(side_effect=httpx.ConnectError("boom"))
    c = make_client()
    result = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert result["error"] == "network"
