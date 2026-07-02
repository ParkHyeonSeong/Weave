# mcp/tests/test_middleware.py
import json
import types

import pytest
from fastmcp.tools.base import ToolResult
import mcp.types as mt

from weave_mcp._middleware import WeaveDriftGuard
from weave_mcp import _app


def _ctx(name="some_tool"):
    return types.SimpleNamespace(message=types.SimpleNamespace(name=name))


def _result(structured):
    return ToolResult(structured_content=structured,
                      content=[mt.TextContent(type="text", text=json.dumps(structured))])


async def test_passes_valid_error_unchanged():
    valid = {"error": {"category": "forbidden", "code": "X", "message": None,
                       "http_status": 200, "retryable": False, "retry_after": None}}

    async def call_next(ctx):
        return _result(valid)

    out = await WeaveDriftGuard().on_call_tool(_ctx(), call_next)
    assert out.structured_content == valid


async def test_passes_success_without_error_key():
    async def call_next(ctx):
        return _result({"tasks": []})
    out = await WeaveDriftGuard().on_call_tool(_ctx(), call_next)
    assert out.structured_content == {"tasks": []}


def _full_err(**over):
    err = {"category": "auth", "code": None, "message": None,
           "http_status": None, "retryable": False, "retry_after": None}
    err.update(over)
    return {"error": err}


async def test_raises_on_bad_category():
    async def call_next(ctx):
        return _result(_full_err(category="nonsense"))

    with pytest.raises(RuntimeError, match="drift"):
        await WeaveDriftGuard().on_call_tool(_ctx(), call_next)


async def test_raises_on_non_bool_retryable():
    async def call_next(ctx):
        return _result(_full_err(retryable="no"))

    with pytest.raises(RuntimeError, match="drift"):
        await WeaveDriftGuard().on_call_tool(_ctx(), call_next)


async def test_raises_on_missing_core_key():
    # the contract requires all six core keys present (values may be None)
    incomplete = {"error": {"category": "auth", "retryable": False}}  # missing 4 core keys

    async def call_next(ctx):
        return _result(incomplete)

    with pytest.raises(RuntimeError, match="drift"):
        await WeaveDriftGuard().on_call_tool(_ctx(), call_next)


async def test_absorbs_unexpected_tool_exception():
    async def call_next(ctx):
        raise ValueError("boom in a tool")

    out = await WeaveDriftGuard().on_call_tool(_ctx("write_scrum_daily"), call_next)
    err = out.structured_content["error"]
    assert err["category"] == "server"
    assert err["code"] == "MCP_TOOL_EXCEPTION"


def test_middleware_registered_on_app():
    assert any(isinstance(m, WeaveDriftGuard) for m in _app.mcp.middleware)


async def test_reraises_not_found_error():
    from fastmcp.exceptions import NotFoundError
    async def call_next(ctx):
        raise NotFoundError("Unknown tool: 'nope'")
    with pytest.raises(NotFoundError):
        await WeaveDriftGuard().on_call_tool(_ctx(), call_next)


import types as _types

from weave_mcp._middleware import BranchRefResolver


def _call_ctx(arguments, name="create_task"):
    return _types.SimpleNamespace(
        message=_types.SimpleNamespace(name=name, arguments=arguments))


async def test_resolver_passes_int_through(fake_client):
    seen = {}

    async def call_next(ctx):
        seen.update(ctx.message.arguments)
        return "ok"

    out = await BranchRefResolver().on_call_tool(
        _call_ctx({"branch_id": 7, "title": "x"}), call_next)
    assert out == "ok"
    assert seen["branch_id"] == 7
    fake_client.call_json.assert_not_awaited()  # int → no resolution lookup


async def test_resolver_rewrites_key_to_id(fake_client):
    fake_client.call_json.return_value = {
        "status": True, "branches": [{"branch_id": 7, "key": "WV"}]}
    seen = {}

    async def call_next(ctx):
        seen.update(ctx.message.arguments)
        return "ok"

    await BranchRefResolver().on_call_tool(
        _call_ctx({"branch_id": "WV", "title": "x"}), call_next)
    assert seen["branch_id"] == 7


async def test_resolver_short_circuits_on_unknown_key(fake_client):
    fake_client.call_json.return_value = {"status": True, "branches": []}
    called = False

    async def call_next(ctx):
        nonlocal called
        called = True
        return "ok"

    out = await BranchRefResolver().on_call_tool(
        _call_ctx({"branch_id": "ZZ", "title": "x"}), call_next)
    assert called is False  # never reaches the tool body
    assert out.structured_content["error"]["code"] == "BRANCH_KEY_NOT_FOUND"


async def test_resolver_ignores_calls_without_branch_id(fake_client):
    async def call_next(ctx):
        return "ok"

    out = await BranchRefResolver().on_call_tool(
        _call_ctx({"q": "hello"}, name="search_tasks"), call_next)
    assert out == "ok"
    fake_client.call_json.assert_not_awaited()


async def test_resolver_short_circuits_on_bool(fake_client):
    # bool is an int subclass; `type(ref) is not int` routes it to the resolver,
    # which rejects it — it must not be passed through as a numeric branch_id.
    called = False

    async def call_next(ctx):
        nonlocal called
        called = True
        return "ok"

    out = await BranchRefResolver().on_call_tool(
        _call_ctx({"branch_id": True, "title": "x"}), call_next)
    assert called is False
    assert out.structured_content["error"]["code"] == "INVALID_BRANCH_REF"
    fake_client.call_json.assert_not_awaited()


def test_branch_ref_resolver_registered_on_app():
    assert any(isinstance(m, BranchRefResolver) for m in _app.mcp.middleware)
