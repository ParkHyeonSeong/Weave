import pytest
from sqlalchemy import text
from core.query.filter_db import validate_custom_fields
from core.query.filter_spec import FilterError


async def _branch(db, uid, key="CF1"):
    bid = (await db.execute(text(
        "INSERT INTO branch (branch_name, key, description, visibility, color, created_by) "
        "VALUES ('B', :k, 'd', 'private', '#5E6AD2', :u) RETURNING branch_id"),
        {"k": key, "u": uid})).scalar_one()
    return bid


async def _user(db):
    return (await db.execute(text(
        "INSERT INTO \"user\" (email, password, username, status) "
        "VALUES ('cf@t.test', :p, 'cf', 'active') RETURNING user_id"), {"p": b"x"})).scalar_one()


async def _type_and_field(db, bid, field_name="Severity"):
    tid = (await db.execute(text(
        "INSERT INTO task_type_config (branch_id, type_key, type_name) "
        "VALUES (:b, 'bug', 'Bug') RETURNING type_id"), {"b": bid})).scalar_one()
    fid = (await db.execute(text(
        "INSERT INTO custom_field (type_id, field_name, field_type, is_required, sort_order) "
        "VALUES (:t, :n, 'select', false, 0) RETURNING custom_field_id"),
        {"t": tid, "n": field_name})).scalar_one()
    return fid


def _spec(fid):
    return {"type": "group", "op": "AND", "negate": False,
            "children": [{"type": "cond", "field": f"cf:{fid}", "op": "eq", "value": "x", "negate": False}]}


async def test_valid_cf_passes(db_session):
    uid = await _user(db_session); bid = await _branch(db_session, uid)
    fid = await _type_and_field(db_session, bid)
    await validate_custom_fields(_spec(fid), bid, db_session)  # no raise


async def test_cf_from_other_branch_rejected(db_session):
    uid = await _user(db_session)
    bid = await _branch(db_session, uid, key="CFA")
    other = await _branch(db_session, uid, key="CFB")
    fid = await _type_and_field(db_session, other)
    with pytest.raises(FilterError):
        await validate_custom_fields(_spec(fid), bid, db_session)


async def test_cf_in_cross_branch_rejected(db_session):
    with pytest.raises(FilterError):
        await validate_custom_fields(_spec(999), None, db_session)
