"""on_call_tool guard: validates the structured error shape on tool returns, and as
defense-in-depth absorbs an unexpected non-framework exception in the call chain into
a structured `server` error; framework control-flow exceptions (FastMCPError/McpError/
NotFoundError — incl. tool-body exceptions FastMCP already wraps as ToolError) are
re-raised and surfaced via FastMCP's native error reporting."""
import json

from fastmcp.server.middleware import Middleware
from fastmcp.exceptions import FastMCPError, McpError, NotFoundError
from fastmcp.tools.base import ToolResult
import mcp.types as mt

from . import errors as E

# Single-source core keys from errors.py.
_CORE_KEYS = E.CORE_KEYS


class WeaveDriftGuard(Middleware):
    async def on_call_tool(self, context, call_next) -> ToolResult:
        try:
            result = await call_next(context)
        except (FastMCPError, McpError, NotFoundError):
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


class BranchRefResolver(Middleware):
    """Resolve a string `branch_id` (a branch key) to its numeric id before the tool runs.

    Mutates `context.message.arguments["branch_id"]` in place; FastMCP reads the
    arguments from the same context when invoking the tool (server.py call_next),
    so the rewrite reaches the tool body. Ints pass through untouched (no lookup).
    """
    async def on_call_tool(self, context, call_next):
        args = getattr(context.message, "arguments", None)
        if isinstance(args, dict):
            ref = args.get("branch_id")
            # `type(ref) is not int` (not `isinstance`) so a bool — an int subclass —
            # goes to the resolver and is rejected, matching resolve_branch_ref's contract.
            if ref is not None and type(ref) is not int:
                from ._app import get_client  # lazy import — avoids _app↔_middleware cycle
                from ._branch_ref import resolve_branch_ref
                resolved, err = await resolve_branch_ref(ref, get_client())
                if err is not None:
                    return ToolResult(
                        structured_content=err,
                        content=[mt.TextContent(type="text", text=json.dumps(err))],
                    )
                args["branch_id"] = resolved
        return await call_next(context)
