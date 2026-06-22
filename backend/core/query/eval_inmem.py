"""FilterSpec 인메모리 평가기(Python). frontend/library/filterSpec.js와 1:1 의미 일치.
parity는 tests/test_filter_parity.py가 공유 픽스처로 강제한다. 날짜는 ISO 문자열 비교."""
import datetime
import re

_REL = re.compile(r"^\$today([+-]\d+)d$")  # grammar는 filter_spec._DATE_TOKEN과 동기
_LEAF = {"status": "status", "status_category": "status_category", "priority": "priority",
         "task_type": "task_type", "epic": "epic_id", "sprint": "sprint_id",
         "created_by": "created_by", "due_date": "due_date", "start_date": "start_date",
         "created_at": "created_at", "updated_at": "updated_at"}
_DATE_FIELDS = {"due_date", "start_date", "created_at", "updated_at"}


def _resolve(value, ctx, is_date):
    if value == "$me":
        return ctx.get("userId")
    if is_date and isinstance(value, str):
        if value == "$today":
            return ctx.get("today")
        m = _REL.match(value)
        if m:
            d = datetime.date.fromisoformat(ctx["today"]) + datetime.timedelta(days=int(m.group(1)))
            return d.isoformat()
    return value


def _cmp(a, op, b):
    if a is None:
        return False
    return {"eq": a == b, "lt": a < b, "lte": a <= b, "gt": a > b, "gte": a >= b}.get(op, False)


def _strip(s):
    return re.sub(r"<[^>]+>", " ", s or "")


def _cf_text(raw):
    """custom_fields raw 값을 비교용 텍스트로 정규화(Py↔JS 일치 + Postgres ->> 근사).
    bool은 소문자 'true'/'false', None은 None(비매칭). 주의: 소수(1.0)는 Py/JS 표기차가
    남으므로 v1 cf는 text/select 위주 — number cf 비교는 권장하지 않음(필터 op도 eq/in/contains/is_empty로 제한)."""
    if raw is None:
        return None
    if isinstance(raw, bool):
        return "true" if raw else "false"
    return str(raw)


def _cond(task, node, ctx):
    field, op, value = node["field"], node["op"], node.get("value")
    if field == "assignee":
        if op == "is_empty":
            return len(task.get("assignees") or []) == 0
        ids = [(_ if _ != "$me" else ctx.get("userId")) for _ in (value if op == "in" else [value])]
        return any(a.get("user_id") in ids for a in (task.get("assignees") or []))
    if field == "label":
        if op == "is_empty":
            return len(task.get("labels") or []) == 0
        s = set(value)
        return any(l.get("label_id") in s for l in (task.get("labels") or []))
    if field == "has_subtasks":
        has = (task.get("subtaskCount") or len(task.get("subtasks") or [])) > 0
        return has if value else not has
    if field == "is_top_level":
        top = task.get("parent_task_id") is None
        return top if value else not top
    if field == "text":
        hay = f"{task.get('title') or ''} {_strip(task.get('description'))}".lower()
        return hay.strip() == str(value).lower() if op == "eq" else str(value).lower() in hay
    if field.startswith("cf:"):
        raw = _cf_text((task.get("custom_fields") or {}).get(field[3:]))
        if op == "is_empty":
            return raw is None
        if raw is None:
            return False
        if op == "contains":
            return str(value).lower() in raw.lower()
        if op == "in":
            return raw in [str(v) for v in value]
        # eq (v1: cf 비교 op 없음)
        return raw == str(value)
    col = _LEAF[field]
    is_date = field in _DATE_FIELDS
    lv = task.get(col)
    if op == "is_empty":
        return lv is None
    if op == "in":
        return lv in [_resolve(v, ctx, is_date) for v in value]
    if op == "between":
        return lv is not None and lv >= _resolve(value[0], ctx, is_date) and lv <= _resolve(value[1], ctx, is_date)
    return _cmp(lv, op, _resolve(value, ctx, is_date))


def evaluate(task, node, ctx=None):
    ctx = ctx or {}
    if not node:
        return True
    if node.get("type") == "group":
        children = node.get("children") or []
        if not children:
            res = True
        elif node.get("op") == "OR":
            res = any(evaluate(task, c, ctx) for c in children)
        else:
            res = all(evaluate(task, c, ctx) for c in children)
    else:
        res = _cond(task, node, ctx)
    return (not res) if node.get("negate") else res
