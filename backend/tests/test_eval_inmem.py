from core.query.eval_inmem import evaluate

CTX = {"userId": 7, "today": "2026-06-22"}
def _g(*c, op="AND", negate=False): return {"type": "group", "op": op, "negate": negate, "children": list(c)}
def _c(f, op, v=None, negate=False): return {"type": "cond", "field": f, "op": op, "value": v, "negate": negate}

TASK = {"status": "todo", "priority": "high", "epic_id": 5, "sprint_id": None,
        "parent_task_id": None, "due_date": "2026-06-25", "title": "Fix login",
        "description": "<p>bug</p>", "assignees": [{"user_id": 7}], "labels": [{"label_id": 3}],
        "custom_fields": {"12": "red"}}

def test_empty_true(): assert evaluate(TASK, _g(), CTX) is True
def test_none_true(): assert evaluate(TASK, None, CTX) is True
def test_eq(): assert evaluate(TASK, _g(_c("priority", "eq", "high")), CTX) is True
def test_negate(): assert evaluate(TASK, _g(_c("priority", "eq", "high", negate=True)), CTX) is False
def test_or(): assert evaluate(TASK, _g(_c("priority", "eq", "low"), _c("status", "eq", "todo"), op="OR"), CTX) is True
def test_label_in(): assert evaluate(TASK, _g(_c("label", "in", [3])), CTX) is True
def test_assignee_me(): assert evaluate(TASK, _g(_c("assignee", "eq", "$me")), CTX) is True
def test_assignee_unassigned(): assert evaluate({**TASK, "assignees": []}, _g(_c("assignee", "is_empty")), CTX) is True
def test_due_relative(): assert evaluate(TASK, _g(_c("due_date", "lt", "$today+7d")), CTX) is True
def test_text_strips_html(): assert evaluate(TASK, _g(_c("text", "contains", "bug")), CTX) is True
def test_sprint_empty(): assert evaluate(TASK, _g(_c("sprint", "is_empty")), CTX) is True
def test_cf_eq(): assert evaluate(TASK, _g(_c("cf:12", "eq", "red")), CTX) is True
