"""MCP-side structured error model (SP-3).

Pure shaping — no httpx. `call_json` (client.py) parses the HTTP response and
delegates here. The single failure envelope is {"error": {category, code, message,
http_status, retryable, retry_after, ...extra}}; the six core keys are always present,
`detail` and other non-reserved backend body keys ride along only when present.
See docs/superpowers/specs/2026-06-25-sp3-mcp-structured-errors-design.md.
"""

import re

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


# Irregular codes whose suffix/keyword rules don't classify correctly.
# Extended to green against the full backend ErrorCode enum by test_errors_parity.py.
_OVERRIDES = {
    "ADMIN_ONLY": "forbidden", "ACCESS_DENIED": "forbidden", "NOT_ALLOWED": "forbidden",
    "PERMISSION_DENIED": "forbidden", "ADMIN_REQUIRED": "forbidden",
    "CIRCULAR_DEPENDENCY": "conflict", "DEPENDENCY_CYCLE": "conflict",
    "PARENT_CYCLE": "conflict", "SELF_DEPENDENCY": "conflict", "SELF_LINK": "conflict",
    "RATE_LIMIT_EXCEEDED": "rate_limited",
    "INTERNAL_SERVER_ERROR": "server",
    "NEED_LOGIN": "auth",
}


def category_for_code(code):
    """Resolve a backend code string to a category. Deterministic; BUSINESS fallback.

    Defensive: the MCP surface almost always receives body['category'] directly
    (error_response dual-emit). This resolver only fires when a categoryless body
    carries a code. Its correctness across the FULL backend enum is asserted by
    test_errors_parity.py — add an _OVERRIDES entry when a new code fails parity.
    """
    if not code:
        return "business"
    if code in _OVERRIDES:
        return _OVERRIDES[code]
    if code.endswith("_NOT_FOUND"):
        return "not_found"
    if code.startswith("NOT_") or code.endswith("_AUTHOR") or code.startswith("PERMISSION_"):
        return "forbidden"
    if code.startswith("INVALID_") or code.endswith("_TOO_LARGE") or code.endswith("_TOO_SHORT"):
        return "validation"
    if code.endswith("_IN_USE") or code.endswith("_ALREADY_EXISTS") or code.endswith("_EXISTS"):
        return "conflict"
    return "business"


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


_CODE_RE = re.compile(r"^[A-Z][A-Z0-9_]+$")

_STATUS_CATEGORY = {
    401: "auth", 403: "forbidden", 404: "not_found",
    413: "validation", 422: "validation", 429: "rate_limited",
}


def _category_from_status(status_code):
    """HTTP status → category. None/unknown → business; any 5xx → server."""
    if status_code is None:
        return "business"
    if status_code >= 500:
        return "server"
    return _STATUS_CATEGORY.get(status_code, "business")


def error_from_body(body, http_status, retry_after=None):
    """Reshape a failure dict body (2xx status:False OR a unified HTTP-error body)."""
    category = body.get("category")
    code = body.get("code")
    message = body.get("message")
    if code is None and isinstance(message, str) and _CODE_RE.match(message):
        code = message
    if category is None:
        # code present → resolve by code; else fall back to the transport status, so a
        # non-2xx free-text body (404 {"message":"Not found"}) → not_found, while a 200
        # status:false free-text body → business (_category_from_status(200) == business).
        category = category_for_code(code) if code else _category_from_status(http_status)
    retryable = body.get("retryable")  # None → make_error derives from category
    extra = {k: v for k, v in body.items() if k not in _RESERVED_BODY_KEYS}
    return make_error(category, code=code, message=message, http_status=http_status,
                      retryable=retryable, retry_after=retry_after, **extra)


def error_from_status(status_code, detail=None, retry_after=None):
    """Pure status→category fallback when no usable category-bearing body exists."""
    return make_error(_category_from_status(status_code), http_status=status_code,
                      retry_after=retry_after, detail=detail)


def normalize_embedded(body, http_status):
    """A 2xx body that already has a truthy top-level 'error'. Lift it; idempotent."""
    err = body.get("error")
    if isinstance(err, dict) and err.get("category") in CATEGORIES and "retryable" in err:
        return body  # already canonical — do not double-wrap
    if isinstance(err, dict):
        return error_from_body(err, http_status)
    return make_error("business", message=str(err), http_status=http_status)
