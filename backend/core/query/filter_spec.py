"""FilterSpec 구조 검증(DB 무관). SQL 빌더·평가기가 공유하는 화이트리스트 계약."""
import datetime as _dt
import re

MAX_DEPTH = 5
MAX_NODES = 50

FIELD_SPECS = {
    "status": {"type": "enum", "ops": {"eq", "in", "is_empty"}},
    "status_category": {"type": "enum", "ops": {"eq", "in"}},
    "priority": {"type": "enum", "ops": {"eq", "in"}},
    "task_type": {"type": "enum", "ops": {"eq", "in"}},
    "label": {"type": "id", "ops": {"in", "is_empty"}},
    "epic": {"type": "id", "ops": {"eq", "in", "is_empty"}},
    "sprint": {"type": "id", "ops": {"eq", "in", "is_empty"}},
    "assignee": {"type": "id", "ops": {"eq", "in", "is_empty"}},
    "created_by": {"type": "id", "ops": {"eq", "in"}},
    "due_date": {"type": "date", "ops": {"eq", "lt", "lte", "gt", "gte", "between", "is_empty"}},
    "start_date": {"type": "date", "ops": {"eq", "lt", "lte", "gt", "gte", "between", "is_empty"}},
    "created_at": {"type": "datetime", "ops": {"lt", "lte", "gt", "gte", "between"}},
    "updated_at": {"type": "datetime", "ops": {"lt", "lte", "gt", "gte", "between"}},
    "text": {"type": "text", "ops": {"contains", "eq"}},
    "has_subtasks": {"type": "bool", "ops": {"eq"}},
    "is_top_level": {"type": "bool", "ops": {"eq"}},
}
_CUSTOM_OPS = {"eq", "in", "contains", "is_empty"}  # v1: 비교/between 제외 — JSONB ->> 는 text라 숫자 비교 오답("10"<"2") 방지. 숫자/날짜 cf 비교는 후속(field_type cast)


class FilterError(ValueError):
    pass


def is_custom_field(field):
    return isinstance(field, str) and field.startswith("cf:") and field[3:].isdigit()


def field_type(field):
    if is_custom_field(field):
        return "custom"
    fs = FIELD_SPECS.get(field)
    return fs["type"] if fs else None


def _ops_for(field):
    if is_custom_field(field):
        return _CUSTOM_OPS
    fs = FIELD_SPECS.get(field)
    return fs["ops"] if fs else None


def validate_filter(spec):
    if spec is None:
        return None
    if _walk(spec, 1) > MAX_NODES:
        raise FilterError(f"too many nodes (>{MAX_NODES})")
    return None


def _walk(node, depth):
    if depth > MAX_DEPTH:
        raise FilterError(f"filter too deep (>{MAX_DEPTH})")
    if not isinstance(node, dict):
        raise FilterError("node must be an object")
    if "negate" in node and not isinstance(node["negate"], bool):
        raise FilterError("negate must be a boolean")
    if node.get("type") == "group":
        if node.get("op") not in ("AND", "OR"):
            raise FilterError("group op must be AND or OR")
        children = node.get("children") or []
        if not isinstance(children, list):
            raise FilterError("children must be a list")
        return 1 + sum(_walk(c, depth + 1) for c in children)
    if node.get("type") == "cond":
        ops = _ops_for(node.get("field"))
        if ops is None:
            raise FilterError(f"unknown field: {node.get('field')}")
        if node.get("op") not in ops:
            raise FilterError(f"op {node.get('op')} not allowed for {node.get('field')}")
        _check_value(node.get("op"), node.get("value"))
        _check_typed(node.get("field"), node.get("op"), node.get("value"))
        return 1
    raise FilterError("node type must be 'group' or 'cond'")


def _check_value(op, value):
    if op == "is_empty" and value is not None:
        raise FilterError("'is_empty' takes no value")  # 잘못된 페이로드가 계약을 통과하지 않도록
    if op == "in" and not (isinstance(value, list) and len(value) > 0):
        raise FilterError("'in' requires a non-empty list")  # 빈 리스트 → SQL IN () 500 차단
    if op == "between" and not (isinstance(value, list) and len(value) == 2):
        raise FilterError("'between' requires [from, to]")


# $today, $today+7d, $today-3d. 이 grammar는 eval_inmem._REL과 동기 유지(거기선 정수 오프셋만 캡처).
_DATE_TOKEN = re.compile(r"^\$today([+-]\d+d)?$")


def _is_date_value(v):
    # date/datetime 공통: ISO 날짜(YYYY-MM-DD) 또는 $today 토큰만. datetime도 v1은 날짜 단위 비교만
    # 지원(타임스탬프 입력 미지원 — 문자열 비교가 Py/JS/SQL에서 동일 동작).
    if not isinstance(v, str):
        return False
    if _DATE_TOKEN.match(v):
        return True
    try:
        _dt.date.fromisoformat(v)
        return True
    except ValueError:
        return False


def _check_typed(field, op, value):
    """필드 타입별 값 검증 — 잘못된 값이 SQL까지 내려가 500 나는 것을 INVALID_FILTER로 차단."""
    if op == "is_empty":
        return
    ftype = field_type(field)
    vals = value if op in ("in", "between") else [value]
    for v in vals:
        if ftype in ("enum", "text", "custom"):
            if not isinstance(v, str):
                raise FilterError(f"{field}: value must be a string")
        elif ftype == "id":
            allow_me = field in ("assignee", "created_by")
            if not (isinstance(v, int) and not isinstance(v, bool)) and not (allow_me and v == "$me"):
                raise FilterError(f"{field}: value must be an integer id" + (" or '$me'" if allow_me else ""))
        elif ftype in ("date", "datetime"):
            if not _is_date_value(v):  # $me 등 비날짜 값 거부 — $me→user_id로 치환돼 잘못된 비교가 SQL로 새는 것 차단
                raise FilterError(f"{field}: value must be ISO date (YYYY-MM-DD) or a $today token")
        elif ftype == "bool":
            if not isinstance(v, bool):
                raise FilterError(f"{field}: value must be boolean true/false")
