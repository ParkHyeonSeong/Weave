from unittest.mock import AsyncMock

from weave_mcp._branch_ref import resolve_branch_ref


def _branches(*pairs):
    return {"status": True, "branches": [{"branch_id": i, "key": k} for k, i in pairs]}


async def test_int_passthrough_no_lookup():
    client = AsyncMock()
    assert await resolve_branch_ref(7, client) == (7, None)
    client.call_json.assert_not_awaited()


async def test_digit_string_treated_as_id():
    client = AsyncMock()
    assert await resolve_branch_ref("12", client) == (12, None)
    client.call_json.assert_not_awaited()


async def test_key_resolves_to_id():
    client = AsyncMock()
    client.call_json.return_value = _branches(("WV", 7))
    assert await resolve_branch_ref("WV", client) == (7, None)
    client.call_json.assert_awaited_once_with("GET", "/api/branches")


async def test_key_is_case_insensitive():
    client = AsyncMock()
    client.call_json.return_value = _branches(("WV", 7))
    assert await resolve_branch_ref("wv", client) == (7, None)


async def test_bare_list_response_shape():
    client = AsyncMock()
    client.call_json.return_value = [{"branch_id": 7, "key": "WV"}]
    assert await resolve_branch_ref("WV", client) == (7, None)


async def test_unknown_key_is_not_found():
    client = AsyncMock()
    client.call_json.return_value = _branches(("WV", 7))
    rid, err = await resolve_branch_ref("ZZ", client)
    assert rid is None
    assert err["error"]["category"] == "not_found"
    assert err["error"]["code"] == "BRANCH_KEY_NOT_FOUND"


async def test_malformed_ref_is_validation_no_lookup():
    client = AsyncMock()
    rid, err = await resolve_branch_ref("not a key!", client)
    assert rid is None
    assert err["error"]["category"] == "validation"
    assert err["error"]["code"] == "INVALID_BRANCH_REF"
    client.call_json.assert_not_awaited()


async def test_bool_is_rejected_not_treated_as_id():
    client = AsyncMock()
    rid, err = await resolve_branch_ref(True, client)  # bool is an int subclass
    assert rid is None
    assert err["error"]["code"] == "INVALID_BRANCH_REF"
    client.call_json.assert_not_awaited()


async def test_list_branches_error_is_propagated():
    client = AsyncMock()
    client.call_json.return_value = {"error": {
        "category": "auth", "code": "INVALID_OR_EXPIRED_TOKEN", "message": None,
        "http_status": 401, "retryable": False, "retry_after": None}}
    rid, err = await resolve_branch_ref("WV", client)
    assert rid is None
    assert err["error"]["category"] == "auth"
