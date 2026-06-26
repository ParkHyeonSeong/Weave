"""on_call_tool guard: validates the structured error shape and absorbs unexpected
tool exceptions into a structured `server` error so a tool never raises into the
MCP layer (SP-3 §7)."""
import json

from fastmcp.server.middleware import Middleware
from fastmcp.exceptions import FastMCPError, McpError
from fastmcp.tools.base import ToolResult
import mcp.types as mt

from . import errors as E

# The wire contract's six core keys — always present (values may be None).
_CORE_KEYS = frozenset({"category", "code", "message", "http_status", "retryable", "retry_after"})


class WeaveDriftGuard(Middleware):
    async def on_call_tool(self, context, call_next) -> ToolResult:
        try:
            result = await call_next(context)
        except (FastMCPError, McpError):
            raise  # framework control-flow signals — never absorb
        except Exception as exc:
            err = E.make_error("server", code=E.MCP_TOOL_EXCEPTION, message=str(exc))
            return ToolResult(
                structured_content=err,
                content=[mt.TextContent(type="text", text=json.dumps(err))],
            )
        sc = result.structured_content
        if isinstance(sc, dict) and "error" in sc:
            self._assert_shape(getattr(context.message, "name", "?"), sc["error"])
        return result

    @staticmethod
    def _assert_shape(tool, err):
        if not isinstance(err, dict):
            raise RuntimeError(f"drift: {tool} error is not a dict: {err!r}")
        missing = _CORE_KEYS - err.keys()
        if missing:
            raise RuntimeError(f"drift: {tool} error missing core keys {sorted(missing)}")
        if err["category"] not in E.CATEGORIES:
            raise RuntimeError(f"drift: {tool} bad category: {err['category']!r}")
        if not isinstance(err["retryable"], bool):
            raise RuntimeError(f"drift: {tool} retryable not bool: {err['retryable']!r}")
