import pytest
from core.query.filter_spec import validate_filter, FilterError

def _g(*c, op="AND", negate=False): return {"type": "group", "op": op, "negate": negate, "children": list(c)}
def _c(f, op, v=None, negate=False): return {"type": "cond", "field": f, "op": op, "value": v, "negate": negate}

def test_none_and_empty_ok():
    validate_filter(None); validate_filter(_g())

def test_valid_nested_ok():
    validate_filter(_g(_c("status", "in", ["todo"]), _g(_c("priority", "eq", "high"), _c("due_date", "lt", "$today+7d"), op="OR")))

def test_unknown_field_rejected():
    with pytest.raises(FilterError): validate_filter(_g(_c("nonsense", "eq", 1)))

def test_op_not_allowed_rejected():
    with pytest.raises(FilterError): validate_filter(_g(_c("text", "in", ["a"])))

def test_in_requires_list():
    with pytest.raises(FilterError): validate_filter(_g(_c("status", "in", "todo")))

def test_between_requires_pair():
    with pytest.raises(FilterError): validate_filter(_g(_c("due_date", "between", ["2026-01-01"])))

def test_depth_limit():
    n = _c("status", "eq", "todo")
    for _ in range(6): n = _g(n)
    with pytest.raises(FilterError): validate_filter(n)

def test_custom_field_format_ok():
    validate_filter(_g(_c("cf:12", "eq", "v")))

def test_custom_field_bad_format_rejected():
    with pytest.raises(FilterError): validate_filter(_g(_c("cf:abc", "eq", "v")))

def test_custom_field_comparison_op_rejected():
    # v1: cf 비교(lt/gt/between)는 허용 안 함(문자열 비교 오답 방지)
    with pytest.raises(FilterError): validate_filter(_g(_c("cf:12", "lt", "5")))

def test_bad_date_value_rejected():
    with pytest.raises(FilterError): validate_filter(_g(_c("due_date", "lt", "abc")))

def test_good_date_values_ok():
    validate_filter(_g(_c("due_date", "lt", "2026-07-01")))
    validate_filter(_g(_c("due_date", "between", ["2026-06-01", "2026-06-30"])))
    validate_filter(_g(_c("due_date", "lt", "$today+7d")))

def test_non_int_id_rejected():
    with pytest.raises(FilterError): validate_filter(_g(_c("label", "in", ["abc"])))

def test_bool_field_non_bool_rejected():
    with pytest.raises(FilterError): validate_filter(_g(_c("has_subtasks", "eq", "yes")))

def test_assignee_me_and_int_ok():
    validate_filter(_g(_c("assignee", "eq", "$me")))
    validate_filter(_g(_c("assignee", "in", [5, 6])))

def test_date_field_me_rejected():
    # $me는 id 필드 전용 — 날짜 필드에 오면 거부(SQL로 user_id 치환되는 것 차단)
    with pytest.raises(FilterError): validate_filter(_g(_c("due_date", "lt", "$me")))

def test_empty_in_rejected():
    with pytest.raises(FilterError): validate_filter(_g(_c("status", "in", [])))

def test_is_empty_with_value_rejected():
    # is_empty는 값을 받지 않음 — 임의 페이로드가 계약을 통과하지 못하게
    with pytest.raises(FilterError): validate_filter(_g(_c("status", "is_empty", "junk")))

def test_negate_non_bool_rejected():
    with pytest.raises(FilterError): validate_filter(_g(_c("priority", "eq", "high", negate="x")))
