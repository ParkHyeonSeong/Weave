"""MCP-side structured error model (SP-3).

Pure shaping — no httpx. `call_json` (client.py) parses the HTTP response and
delegates here. The single failure envelope is {"error": {category, code, message,
http_status, retryable, retry_after, ...extra}}; the six core keys are always present,
`detail` and other non-reserved backend body keys ride along only when present.
See docs/superpowers/specs/2026-06-25-sp3-mcp-structured-errors-design.md.
"""

# 9 categories — identical strings to backend core.errors.Category
CATEGORIES = frozenset({
    "auth", "forbidden", "not_found", "validation",
    "conflict", "rate_limited", "network", "server", "business",
})
RETRYABLE = frozenset({"network", "server", "rate_limited"})

# Keys the backend framework owns; never copied verbatim into the error object.
_RESERVED_BODY_KEYS = frozenset({"status", "message", "code", "category", "retryable"})

# MCP-local codes — never a backend ErrorCode; each MUST have a real emission path.
TOKEN_NOT_SET = "TOKEN_NOT_SET"            # missing/empty configured token (client.py)
WEEKEND_NO_CELL = "WEEKEND_NO_CELL"        # scrum weekend guard (tools/scrum.py)
MCP_TOOL_EXCEPTION = "MCP_TOOL_EXCEPTION"  # unexpected tool exception (_middleware.py)
MCP_LOCAL_CODES = frozenset({TOKEN_NOT_SET, WEEKEND_NO_CELL, MCP_TOOL_EXCEPTION})


def make_error(category, *, code=None, message=None, http_status=None,
               retryable=None, retry_after=None, **extra):
    """Build the canonical nested failure envelope {"error": {...}}.

    retryable defaults to category-derivation when None. Any **extra key not in
    _RESERVED_BODY_KEYS and not None is appended (this is how `detail` survives).
    """
    if category not in CATEGORIES:
        category = "business"
    err = {
        "category": category,
        "code": code,
        "message": message,
        "http_status": http_status,
        "retryable": (category in RETRYABLE) if retryable is None else bool(retryable),
        "retry_after": retry_after,
    }
    for k, v in extra.items():
        if k not in _RESERVED_BODY_KEYS and v is not None:
            err[k] = v
    return {"error": err}
