from sqlalchemy import text
from core.query.filter_spec import FilterError, is_custom_field


def _collect_cf_ids(node, acc):
    if not isinstance(node, dict):
        return
    if node.get("type") == "group":
        for c in node.get("children") or []:
            _collect_cf_ids(c, acc)
    elif node.get("type") == "cond" and is_custom_field(node.get("field")):
        acc.add(int(node["field"][3:]))


async def validate_custom_fields(spec, branch_id, db):
    if spec is None:
        return
    ids = set()
    _collect_cf_ids(spec, ids)
    if not ids:
        return
    if branch_id is None:
        raise FilterError("custom field filters require a branch scope")
    rows = await db.execute(text("""
        SELECT cf.custom_field_id
        FROM custom_field cf
        INNER JOIN task_type_config tt ON tt.type_id = cf.type_id
        WHERE tt.branch_id = :branch_id AND cf.custom_field_id = ANY(:ids)
    """), {"branch_id": branch_id, "ids": list(ids)})
    valid = {r[0] for r in rows.fetchall()}
    missing = ids - valid
    if missing:
        raise FilterError(f"custom fields not in this branch: {sorted(missing)}")
