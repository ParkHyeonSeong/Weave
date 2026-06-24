"""FilterSpec -> SQL WHERE 단편(bound params만). 컬럼 별칭 't' 기준.
text 필드 SQL은 마이그 054(idx_task_title_trgm/idx_task_desc_trgm) 함수형 인덱스 식과 동일."""
import datetime
import re
from core.query.filter_spec import validate_filter, is_custom_field

_COLUMN = {"status": "t.status", "priority": "t.priority", "task_type": "t.task_type",
           "epic": "t.epic_id", "sprint": "t.sprint_id", "created_by": "t.created_by",
           "due_date": "t.due_date", "start_date": "t.start_date",
           "created_at": "t.created_at", "updated_at": "t.updated_at"}
_DATE_FIELDS = {"due_date", "start_date", "created_at", "updated_at"}
_REL = re.compile(r"^\$today([+-]\d+)d$")
_OP = {"eq": "=", "lt": "<", "lte": "<=", "gt": ">", "gte": ">="}


def build_where(spec, ctx):
    validate_filter(spec)
    if spec is None:
        return "TRUE", {}
    params, counter = {}, {"n": 0}
    return _node(spec, ctx, params, counter) or "TRUE", params


def _key(counter):
    k = f"p{counter['n']}"; counter["n"] += 1; return k


def _like_escape(value):
    """LIKE 메타문자(\\ % _)를 백슬래시로 이스케이프 → contains를 리터럴 부분문자열로.
    (in-mem 평가기와 패리티: 사용자 입력 %/_가 와일드카드로 새지 않도록)
    백슬래시를 먼저 이스케이프해야 새로 추가한 백슬래시를 이중처리하지 않음."""
    return str(value).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _resolve(value, ctx, is_date):
    if value == "$me":
        return ctx["user_id"]
    if is_date and isinstance(value, str):
        if value == "$today":
            return ctx["today"]
        m = _REL.match(value)
        if m:
            return ctx["today"] + datetime.timedelta(days=int(m.group(1)))
    return value


def _node(node, ctx, params, counter):
    if node.get("type") == "group":
        ch = node.get("children") or []
        inner = "TRUE" if not ch else f" {node['op']} ".join(f"({_node(c, ctx, params, counter)})" for c in ch)
        return f"NOT ({inner})" if node.get("negate") else inner
    frag = _cond(node, ctx, params, counter)
    return f"NOT ({frag})" if node.get("negate") else frag


def _cond(node, ctx, params, counter):
    field, op, value = node["field"], node["op"], node.get("value")
    if field == "assignee":
        return _exists_user(op, value, ctx, params, counter)
    if field == "label":
        return _exists_label(op, value, params, counter)
    if field == "status_category":
        return _exists_category(op, value, params, counter)
    if field == "text":
        return _text(op, value, params, counter)
    if field == "has_subtasks":
        s = "EXISTS (SELECT 1 FROM task c WHERE c.parent_task_id = t.task_id)"
        return s if value else f"(NOT {s})"
    if field == "is_top_level":
        return "t.parent_task_id IS NULL" if value else "t.parent_task_id IS NOT NULL"
    if is_custom_field(field):
        return _custom(field, op, value, params, counter)
    return _scalar(_COLUMN[field], op, value, field in _DATE_FIELDS, ctx, params, counter)


def _scalar(col, op, value, is_date, ctx, params, counter):
    if op == "is_empty":
        return f"{col} IS NULL"
    if op == "in":
        base = _key(counter); keys = []
        for i, v in enumerate(value):
            k = f"{base}_{i}"; params[k] = _resolve(v, ctx, is_date); keys.append(f":{k}")
        return f"{col} IN ({', '.join(keys)})"
    if op == "between":
        k0, k1 = _key(counter), _key(counter)
        params[k0] = _resolve(value[0], ctx, is_date); params[k1] = _resolve(value[1], ctx, is_date)
        return f"{col} BETWEEN :{k0} AND :{k1}"
    k = _key(counter); params[k] = _resolve(value, ctx, is_date)
    return f"{col} {_OP[op]} :{k}"


def _exists_user(op, value, ctx, params, counter):
    if op == "is_empty":
        return "(NOT EXISTS (SELECT 1 FROM task_assignee ta WHERE ta.task_id = t.task_id))"
    keys = []
    for v in (value if op == "in" else [value]):
        k = _key(counter); params[k] = ctx["user_id"] if v == "$me" else v; keys.append(f":{k}")
    return f"EXISTS (SELECT 1 FROM task_assignee ta WHERE ta.task_id = t.task_id AND ta.user_id IN ({', '.join(keys)}))"


def _exists_label(op, value, params, counter):
    if op == "is_empty":
        return "(NOT EXISTS (SELECT 1 FROM task_label tl WHERE tl.task_id = t.task_id))"
    keys = []
    for v in value:
        k = _key(counter); params[k] = v; keys.append(f":{k}")
    return f"EXISTS (SELECT 1 FROM task_label tl WHERE tl.task_id = t.task_id AND tl.label_id IN ({', '.join(keys)}))"


def _exists_category(op, value, params, counter):
    keys = []
    for v in (value if op == "in" else [value]):
        k = _key(counter); params[k] = v; keys.append(f":{k}")
    return ("EXISTS (SELECT 1 FROM workflow_status ws WHERE ws.branch_id = t.branch_id "
            f"AND ws.key = t.status AND ws.category IN ({', '.join(keys)}))")


def _text(op, value, params, counter):
    k = _key(counter); params[k] = f"%{_like_escape(value)}%"  # text는 contains만(eq 제외), 리터럴 부분문자열
    # 054 인덱스 식과 글자 그대로 동일해야 함
    return (f"(t.title ILIKE :{k} ESCAPE '\\' "
            f"OR regexp_replace(t.description, '<[^>]+>', ' ', 'g') ILIKE :{k} ESCAPE '\\')")


def _custom(field, op, value, params, counter):
    fid = field[3:]  # cf:<digits> 로 검증됨 → 정수 문자열만
    expr = f"(t.custom_fields ->> '{fid}')"
    if op == "is_empty":
        return f"{expr} IS NULL"
    if op == "contains":
        k = _key(counter); params[k] = f"%{_like_escape(value)}%"; return f"{expr} ILIKE :{k} ESCAPE '\\'"
    if op == "in":
        keys = []
        for v in value:
            k = _key(counter); params[k] = str(v); keys.append(f":{k}")
        return f"{expr} IN ({', '.join(keys)})"
    # eq (v1: cf 비교 op 없음 — JSONB ->> 는 text라 숫자 비교 오답 방지)
    k = _key(counter); params[k] = str(value)
    return f"{expr} = :{k}"


_PRIORITY_CASE = ("CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 "
                  "WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END")
# status는 브랜치별 workflow_status.sort_order로 정렬(태스크 status를 그 브랜치 워크플로에 매핑).
# 평면 뷰의 단일정렬(클라이언트는 워크플로 순서로 정렬)을 saved_view_id로 서버/MCP에서 쓸 때도 동일하게
# 정렬되도록 parity 보장. (branch_id,key) UNIQUE라 스칼라 서브쿼리 안전, 매칭 없으면 NULL→NULLS LAST.
_STATUS_ORDER = ("(SELECT ws.sort_order FROM workflow_status ws "
                 "WHERE ws.branch_id = t.branch_id AND ws.key = t.status)")
_ORDERABLE = {"priority": _PRIORITY_CASE, "due_date": "t.due_date", "start_date": "t.start_date",
              "created": "t.created_at", "created_at": "t.created_at",
              "updated_at": "t.updated_at", "title": "t.title", "status": _STATUS_ORDER}


def build_order(sort):
    parts = []
    for s in (sort or []):
        expr = _ORDERABLE.get(s.get("field"))
        if not expr:
            continue
        direction = "DESC" if str(s.get("dir", "asc")).lower() == "desc" else "ASC"
        parts.append(f"{expr} {direction} NULLS LAST")
    parts.append("t.task_id")
    return ", ".join(parts)
