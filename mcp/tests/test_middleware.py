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
