import httpx
import respx

from weave_mcp.client import WeaveClient
from weave_mcp.config import Settings


def make_client(token="wv_test_token"):
    return WeaveClient(settings=Settings(base_url="http://test", token=token))


@respx.mock
async def test_call_sends_bearer_header():
    route = respx.get("http://test/api/branches").mock(return_value=httpx.Response(200, json=[]))
    c = make_client("wv_abc")
    await c.call("GET", "/api/branches")
    await c.aclose()
    assert route.calls[0].request.headers.get("authorization") == "Bearer wv_abc"


@respx.mock
async def test_call_json_success_returns_parsed_body():
    respx.get("http://test/api/branches").mock(return_value=httpx.Response(200, json=[{"id": 1}]))
    c = make_client()
    result = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert result == [{"id": 1}]


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
async def test_call_json_401_returns_auth_error_no_http_retry():
    # A revoked/expired token (401) is surfaced as error="auth" — distinct from a
    # forbidden resource — so the model can stop hammering every tool with a dead token.
    route = respx.get("http://test/api/branches").mock(return_value=httpx.Response(401))
    c = make_client()
    result = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert result["error"] == "auth"
    assert route.call_count == 1  # a 401 response is not a connect error → no retry


@respx.mock
async def test_call_json_403_stays_distinct_from_auth():
    # 403 = authenticated but forbidden THIS resource — not a dead token, so it keeps
    # the numeric code (an agent should not treat it as "stop, bad token").
    respx.get("http://test/api/branches/9").mock(return_value=httpx.Response(403, json={"message": "FORBIDDEN"}))
    c = make_client()
    result = await c.call_json("GET", "/api/branches/9")
    await c.aclose()
    assert result["error"] == 403
    assert result["detail"] == {"message": "FORBIDDEN"}


@respx.mock
async def test_call_json_network_error_returns_error_dict():
    respx.get("http://test/api/branches").mock(side_effect=httpx.ConnectError("boom"))
    c = make_client()
    result = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert result["error"] == "network"


def test_client_uses_granular_timeout():
    c = make_client()
    t = c._http.timeout
    assert t.connect == 5.0
    assert t.read == 30.0
    assert t.write == 10.0
    assert t.pool == 5.0


async def test_call_json_missing_token_returns_auth_error():
    c = make_client(token="")
    result = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert result["error"] == "auth"


@respx.mock
async def test_call_json_business_failure_200_returns_error_dict():
    respx.post("http://test/api/branches/9/dependencies").mock(
        return_value=httpx.Response(200, json={"status": False, "message": "CIRCULAR_DEPENDENCY"})
    )
    c = make_client()
    result = await c.call_json("POST", "/api/branches/9/dependencies")
    await c.aclose()
    assert result["error"] == "business"
    assert result["detail"] == "CIRCULAR_DEPENDENCY"


@respx.mock
async def test_call_json_status_true_returns_body_unchanged():
    respx.get("http://test/api/auth/me").mock(
        return_value=httpx.Response(200, json={"status": True, "profile": {"user_id": 1}})
    )
    c = make_client()
    result = await c.call_json("GET", "/api/auth/me")
    await c.aclose()
    assert result == {"status": True, "profile": {"user_id": 1}}
