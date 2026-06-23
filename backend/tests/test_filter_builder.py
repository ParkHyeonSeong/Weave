import datetime
from core.query.filter_builder import build_where
CTX = {"user_id": 7, "today": datetime.date(2026, 6, 22)}
def _g(*c, op="AND", negate=False): return {"type": "group", "op": op, "negate": negate, "children": list(c)}
def _c(f, op, v=None, negate=False): return {"type": "cond", "field": f, "op": op, "value": v, "negate": negate}

def test_none_true():
    assert build_where(None, CTX) == ("TRUE", {})

def test_eq_bound():
    sql, p = build_where(_g(_c("priority", "eq", "high")), CTX)
    assert "t.priority = :p0" in sql and p == {"p0": "high"}

def test_in_list():
    sql, p = build_where(_g(_c("status", "in", ["todo", "doing"])), CTX)
    assert "t.status IN (:p0_0, :p0_1)" in sql and p == {"p0_0": "todo", "p0_1": "doing"}

def test_negate():
    sql, _ = build_where(_g(_c("priority", "eq", "high", negate=True)), CTX)
    assert "NOT (" in sql

def test_or():
    sql, _ = build_where(_g(_c("priority", "eq", "high"), _c("priority", "eq", "urgent"), op="OR"), CTX)
    assert " OR " in sql

def test_assignee_me_exists():
    sql, p = build_where(_g(_c("assignee", "eq", "$me")), CTX)
    assert "task_assignee" in sql and 7 in p.values()

def test_label_exists():
    sql, _ = build_where(_g(_c("label", "in", [3, 4])), CTX)
    assert "EXISTS" in sql and "task_label" in sql

def test_relative_date():
    _, p = build_where(_g(_c("due_date", "lt", "$today+7d")), CTX)
    assert datetime.date(2026, 6, 29) in p.values()

def test_text_matches_054_expression():
    sql, _ = build_where(_g(_c("text", "contains", "login")), CTX)
    # 054 함수형 인덱스 식과 동일해야 함
    assert "t.title ILIKE" in sql
    assert "regexp_replace(t.description, '<[^>]+>', ' ', 'g') ILIKE" in sql

def test_status_category_exists():
    sql, _ = build_where(_g(_c("status_category", "in", ["done"])), CTX)
    assert "workflow_status" in sql and "ws.category IN" in sql

def test_custom_field_jsonb():
    sql, _ = build_where(_g(_c("cf:12", "eq", "v")), CTX)
    assert "custom_fields ->> '12'" in sql

def test_text_contains_escapes_like_wildcards():
    # 사용자 입력의 %/_ 는 SQL 와일드카드가 아니라 리터럴로 매칭돼야 함
    sql, p = build_where(_g(_c("text", "contains", "a%b_c")), CTX)
    assert p == {"p0": "%a\\%b\\_c%"}
    assert "ESCAPE" in sql

def test_text_contains_escapes_backslash_first():
    # 백슬래시를 먼저 이스케이프해야 새로 추가한 백슬래시를 이중처리하지 않음
    _, p = build_where(_g(_c("text", "contains", "a\\b")), CTX)
    assert p == {"p0": "%a\\\\b%"}

def test_custom_contains_escapes_like_wildcards():
    sql, p = build_where(_g(_c("cf:12", "contains", "x_y%z")), CTX)
    assert p == {"p0": "%x\\_y\\%z%"}
    assert "ESCAPE" in sql


from core.query.filter_builder import build_order

def test_order_default():
    assert build_order(None).endswith("t.task_id")

def test_order_priority_case():
    assert "CASE" in build_order([{"field": "priority", "dir": "asc"}])

def test_order_multi():
    sql = build_order([{"field": "due_date", "dir": "asc"}, {"field": "created_at", "dir": "desc"}])
    assert sql.index("due_date") < sql.index("created_at") < sql.index("t.task_id")

def test_order_unknown_ignored():
    assert build_order([{"field": "evil; DROP", "dir": "asc"}]).strip() == "t.task_id"
