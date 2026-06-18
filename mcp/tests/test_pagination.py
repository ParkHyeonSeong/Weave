import json

from weave_mcp._pagination import DEFAULT_LIMIT, MAX_PAGE_CHARS, paginate


def test_passes_through_non_dict():
    assert paginate([1, 2, 3], "tasks") == [1, 2, 3]


def test_passes_through_error_result():
    err = {"error": "business", "detail": "NOT_MEMBER"}
    assert paginate(err, "tasks") == err


def test_passes_through_missing_or_non_list_key():
    r = {"status": True, "other": [1]}
    assert paginate(r, "tasks") == r
    r2 = {"status": True, "tasks": "not-a-list"}
    assert paginate(r2, "tasks") == r2


def test_default_limit_slices_and_flags_more():
    tasks = [{"i": i} for i in range(DEFAULT_LIMIT + 30)]
    out = paginate({"status": True, "tasks": tasks}, "tasks")
    assert out["tasks"][0] == {"i": 0}
    assert out["pagination"] == {
        "total": DEFAULT_LIMIT + 30,
        "returned": DEFAULT_LIMIT,
        "offset": 0,
        "limit": DEFAULT_LIMIT,
        "has_more": True,
        "size_capped": False,
    }


def test_explicit_limit_and_offset():
    tasks = [{"i": i} for i in range(100)]
    out = paginate({"status": True, "tasks": tasks}, "tasks", limit=10, offset=20)
    assert [t["i"] for t in out["tasks"]] == list(range(20, 30))
    assert out["pagination"] == {
        "total": 100,
        "returned": 10,
        "offset": 20,
        "limit": 10,
        "has_more": True,
        "size_capped": False,
    }


def test_last_page_has_no_more():
    tasks = [{"i": i} for i in range(15)]
    out = paginate({"status": True, "tasks": tasks}, "tasks", limit=10, offset=10)
    assert out["pagination"]["returned"] == 5
    assert out["pagination"]["has_more"] is False


def test_offset_past_end_is_empty():
    tasks = [{"i": i} for i in range(5)]
    out = paginate({"status": True, "tasks": tasks}, "tasks", offset=99)
    assert out["tasks"] == []
    assert out["pagination"]["has_more"] is False


def test_zero_or_negative_args_fall_back_to_defaults():
    tasks = [{"i": i} for i in range(10)]
    out = paginate({"status": True, "tasks": tasks}, "tasks", limit=0, offset=-5)
    assert out["pagination"]["offset"] == 0
    assert out["pagination"]["limit"] == DEFAULT_LIMIT
    assert out["pagination"]["returned"] == 10


def test_size_cap_shrinks_oversized_page():
    tasks = [{"i": i, "blob": "x" * 5000} for i in range(50)]  # ~250k chars
    out = paginate({"status": True, "tasks": tasks}, "tasks", limit=50)
    assert out["pagination"]["size_capped"] is True
    assert out["pagination"]["returned"] < 50
    assert out["pagination"]["has_more"] is True
    assert len(json.dumps(out["tasks"], ensure_ascii=False)) <= MAX_PAGE_CHARS


def test_preserves_sibling_fields_and_uses_given_key():
    src = {"status": True, "items": [{"i": 1}], "track_id": 7}
    out = paginate(src, "items")
    assert out["track_id"] == 7
    assert out["status"] is True
    assert out["items"] == [{"i": 1}]
    assert out["pagination"]["total"] == 1
