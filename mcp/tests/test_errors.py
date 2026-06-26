from weave_mcp.errors import (
    make_error, CATEGORIES, RETRYABLE, MCP_LOCAL_CODES,
    TOKEN_NOT_SET, WEEKEND_NO_CELL, MCP_TOOL_EXCEPTION,
)


def test_make_error_core_keys_always_present():
    out = make_error("forbidden", code="ADMIN_REQUIRED", message="nope", http_status=401)
    assert out == {"error": {
        "category": "forbidden", "code": "ADMIN_REQUIRED", "message": "nope",
        "http_status": 401, "retryable": False, "retry_after": None,
    }}


def test_make_error_retryable_derived_from_category():
    assert make_error("network")["error"]["retryable"] is True
    assert make_error("server")["error"]["retryable"] is True
    assert make_error("rate_limited")["error"]["retryable"] is True
    assert make_error("validation")["error"]["retryable"] is False


def test_make_error_explicit_retryable_wins_over_derivation():
    # backend body said retryable=True for a normally-non-retryable category
    assert make_error("business", retryable=True)["error"]["retryable"] is True


def test_make_error_unknown_category_falls_back_to_business():
    assert make_error("nonsense")["error"]["category"] == "business"


def test_make_error_extra_keys_pass_through_when_present():
    out = make_error("validation", code="INVALID_FILTER", detail="bad: [12]")
    assert out["error"]["detail"] == "bad: [12]"


def test_make_error_reserved_extra_keys_are_dropped():
    out = make_error("business", status=False, message="m", code="C")
    # status/message/code handled via named params or dropped; never duplicated as junk
    assert "status" not in out["error"]


def test_make_error_none_extra_omitted():
    out = make_error("auth", code=TOKEN_NOT_SET)
    assert "detail" not in out["error"]


def test_constants_shape():
    assert CATEGORIES == frozenset({
        "auth", "forbidden", "not_found", "validation",
        "conflict", "rate_limited", "network", "server", "business",
    })
    assert RETRYABLE == frozenset({"network", "server", "rate_limited"})
    assert MCP_LOCAL_CODES == frozenset({TOKEN_NOT_SET, WEEKEND_NO_CELL, MCP_TOOL_EXCEPTION})
