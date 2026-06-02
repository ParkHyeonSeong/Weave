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
async def test_call_json_401_returns_error_dict_no_retry():
    route = respx.get("http://test/api/branches").mock(return_value=httpx.Response(401))
    c = make_client()
    result = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert result["error"] == 401
    assert route.call_count == 1  # no retry


@respx.mock
async def test_call_json_network_error_returns_error_dict():
    respx.get("http://test/api/branches").mock(side_effect=httpx.ConnectError("boom"))
    c = make_client()
    result = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert result["error"] == "network"


async def test_call_json_missing_token_returns_auth_error():
    c = make_client(token="")
    result = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert result["error"] == "auth"
