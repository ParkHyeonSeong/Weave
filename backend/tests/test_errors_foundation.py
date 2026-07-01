import re
from pathlib import Path

import pytest

import core.controller as controller_pkg
from core.errors import (
    Category,
    ErrorCode,
    error_response,
    category_of,
    is_retryable,
    SYNONYMS,
)


def test_error_response_shape_and_dual_emit():
    body = error_response(ErrorCode.NOT_BRANCH_MEMBER)
    assert body == {
        "status": False,
        "message": "NOT_BRANCH_MEMBER",   # legacy dual-emit, equals the code
        "code": "NOT_BRANCH_MEMBER",
        "category": "forbidden",
        "retryable": False,
    }


def test_error_response_accepts_plain_string():
    assert error_response("CIRCULAR_DEPENDENCY")["category"] == "conflict"


def test_error_response_merges_extra_fields():
    body = error_response(ErrorCode.NOT_A_MEMBER, resource="branch")
    assert body["code"] == "NOT_A_MEMBER"
    assert body["resource"] == "branch"


def test_retryable_only_for_server_ratelimit_network():
    assert is_retryable(ErrorCode.RATE_LIMIT_EXCEEDED) is True
    assert is_retryable(ErrorCode.INTERNAL_SERVER_ERROR) is True
    assert is_retryable(ErrorCode.MIGRATION_FAILED) is True
    assert is_retryable(ErrorCode.NOT_BRANCH_MEMBER) is False
    assert is_retryable(ErrorCode.INVALID_DATE_RANGE) is False


def test_every_member_has_a_category():
    for member in ErrorCode:
        assert isinstance(member.category, Category)
        assert member.retryable == (member.category in {
            Category.RATE_LIMITED, Category.NETWORK, Category.SERVER
        })


def test_unknown_code_falls_back_to_business():
    assert category_of("TOTALLY_MADE_UP") is Category.BUSINESS
    assert error_response("TOTALLY_MADE_UP")["category"] == "business"


def test_known_controller_codes_are_registered():
    # A representative sample spanning every category — guards against drift.
    sample = {
        "NOT_BRANCH_MEMBER", "PERMISSION_DENIED", "ADMIN_ONLY",          # forbidden
        "TASK_NOT_FOUND", "BRANCH_NOT_FOUND", "SPRINT_NOT_FOUND",        # not_found
        "INVALID_DATE_RANGE", "INVALID_TASK_TYPE", "INVALID_DATE",       # validation
        "CIRCULAR_DEPENDENCY", "KEY_ALREADY_EXISTS", "ALREADY_MEMBER",   # conflict
        "INVALID_CREDENTIALS", "NEED_LOGIN",                            # auth
        "LAST_ADMIN", "SPRINT_EMPTY",                                   # business
        "RATE_LIMIT_EXCEEDED",                                          # rate_limited
        "INTERNAL_SERVER_ERROR", "AI_NOT_CONFIGURED",                  # server
    }
    registered = {m.value for m in ErrorCode}
    assert sample <= registered


def test_invalid_custom_field_registered_and_shaped():
    assert "INVALID_CUSTOM_FIELD" in {m.value for m in ErrorCode}
    body = error_response(ErrorCode.INVALID_CUSTOM_FIELD)
    assert body == {
        "status": False,
        "message": "INVALID_CUSTOM_FIELD",
        "code": "INVALID_CUSTOM_FIELD",
        "category": "validation",
        "retryable": False,
    }


def test_synonyms_point_to_registered_canonicals():
    for dep, canonical in SYNONYMS.items():
        assert isinstance(canonical, ErrorCode)
        assert dep in {m.value for m in ErrorCode}  # deprecated still registered until migration


def test_error_response_rejects_reserved_extra_keys():
    # status/message/category/retryable can only arrive via **extra — the guard rejects them.
    for bad in ("status", "message", "category", "retryable"):
        with pytest.raises(ValueError):
            error_response("NOT_BRANCH_MEMBER", **{bad: "evil"})
    # `code` is the positional parameter — passing it again as a keyword is a TypeError
    # (Python binds it to the param, not **extra), so it can never reach the body to
    # override the code field. Verify that, rather than expecting the ValueError guard.
    with pytest.raises(TypeError):
        error_response("NOT_BRANCH_MEMBER", code="evil")
    # Non-reserved context fields are allowed.
    assert error_response("NOT_BRANCH_MEMBER", resource="branch")["resource"] == "branch"


def test_all_controller_failure_codes_are_registered():
    """Drift guard: every error code in a `{'status': False, 'message': '...'}` failure
    return in any controller must be a registered ErrorCode. Scans the real source (not a
    hand-maintained sample), scoped to status:False so SUCCESS messages on status:True
    dicts (e.g. auth's REGISTRATION_PENDING/REGISTRATION_SUCCESS) are not mistaken for
    error codes. All failure sites put status:False and message adjacent on one line."""
    registered = {m.value for m in ErrorCode}
    controller_dir = Path(controller_pkg.__file__).parent
    failure_code = re.compile(
        r"""['"]status['"]\s*:\s*False\s*,\s*['"]message['"]\s*:\s*['"]([A-Z][A-Z0-9_]{2,})['"]"""
    )
    found = set()
    for py in controller_dir.glob("*.py"):
        found.update(failure_code.findall(py.read_text(encoding="utf-8")))
    assert found, "scan found no failure codes — regex or path is wrong"
    missing = found - registered
    assert not missing, f"Unregistered error codes in controllers: {sorted(missing)}"


def test_github_error_codes_present_and_categorized():
    from core.errors import ErrorCode, Category, error_response

    assert ErrorCode.REF_NOT_FOUND == "REF_NOT_FOUND"
    assert ErrorCode.REF_NOT_FOUND.category is Category.NOT_FOUND
    assert ErrorCode.REF_NOT_FOUND.retryable is False

    assert ErrorCode.INVALID_STATUS_TRANSITION == "INVALID_STATUS_TRANSITION"
    assert ErrorCode.INVALID_STATUS_TRANSITION.category is Category.CONFLICT
    assert ErrorCode.INVALID_STATUS_TRANSITION.retryable is False

    body = error_response(ErrorCode.REF_NOT_FOUND)
    assert body == {
        "status": False,
        "message": "REF_NOT_FOUND",
        "code": "REF_NOT_FOUND",
        "category": "not_found",
        "retryable": False,
    }

    body2 = error_response(ErrorCode.INVALID_STATUS_TRANSITION)
    assert body2["code"] == "INVALID_STATUS_TRANSITION"
    assert body2["category"] == "conflict"

    # manual-link codes (consumed by Slice 4's github_ref controller)
    assert ErrorCode.INVALID_GITHUB_URL.category is Category.VALIDATION
    assert ErrorCode.REPO_NOT_CONNECTED.category is Category.VALIDATION
    assert ErrorCode.GITHUB_FETCH_FAILED.category is Category.SERVER
    assert error_response(ErrorCode.INVALID_GITHUB_URL)["category"] == "validation"
    assert error_response(ErrorCode.GITHUB_FETCH_FAILED)["category"] == "server"
    # retryability follows category: VALIDATION not-retryable, SERVER retryable (RETRYABLE_CATEGORIES)
    assert ErrorCode.INVALID_GITHUB_URL.retryable is False
    assert ErrorCode.REPO_NOT_CONNECTED.retryable is False
    assert ErrorCode.GITHUB_FETCH_FAILED.retryable is True
    assert error_response(ErrorCode.GITHUB_FETCH_FAILED)["retryable"] is True
