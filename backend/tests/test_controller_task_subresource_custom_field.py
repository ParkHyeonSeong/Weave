"""custom field 값 검증기(validate_custom_field_values) 단위 테스트.

Slice 0: 네이티브 타입 허용 / null clear / strict-unknown 거부 / lenient 무시 /
select 옵션 멤버십. 검증기는 type_id 기준으로 동작.
"""
import json

from sqlalchemy import text

from library.custom_field_validator import validate_custom_field_values
from core.errors import ErrorCode


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Branch", key="KEY"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    bid = row.scalar_one()
    await db.execute(text("""
        INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
        VALUES (:b, 'task', 'Task', 'check', '#5E6AD2', 0)
    """), {"b": bid})
    return bid


async def _type_id(db, branch_id, type_key='task'):
    row = await db.execute(text("""
        SELECT type_id FROM task_type_config WHERE branch_id = :b AND type_key = :k
    """), {"b": branch_id, "k": type_key})
    return row.scalar_one()


async def _make_field(db, type_id, name, field_type, options=None, required=False):
    row = await db.execute(text("""
        INSERT INTO custom_field (type_id, field_name, field_type, field_options, is_required, sort_order)
        VALUES (:t, :n, :ft, :o, :r, 0) RETURNING custom_field_id
    """), {"t": type_id, "n": name, "ft": field_type,
           "o": json.dumps(options) if options else None, "r": required})
    return row.scalar_one()


async def test_validator_accepts_native_number_and_null(db_session):
    alice = await _make_user(db_session, "v_a@t.test", "v_a")
    b1 = await _make_branch(db_session, alice, name="V1", key="VV1")
    tid = await _type_id(db_session, b1)
    fnum = await _make_field(db_session, tid, "Num", "number")
    assert await validate_custom_field_values(tid, {str(fnum): 42}, db_session, strict=True) is None
    assert await validate_custom_field_values(tid, {str(fnum): None}, db_session, strict=True) is None


async def test_validator_strict_rejects_unknown_key_and_bad_type(db_session):
    alice = await _make_user(db_session, "v_b@t.test", "v_b")
    b1 = await _make_branch(db_session, alice, name="V2", key="VV2")
    tid = await _type_id(db_session, b1)
    fnum = await _make_field(db_session, tid, "Num", "number")
    assert await validate_custom_field_values(tid, {"99999": 1}, db_session, strict=True) == ErrorCode.INVALID_CUSTOM_FIELD
    assert await validate_custom_field_values(tid, {str(fnum): "nope"}, db_session, strict=True) == ErrorCode.INVALID_CUSTOM_FIELD


async def test_validator_lenient_ignores_unknown_key_validates_known(db_session):
    alice = await _make_user(db_session, "v_c@t.test", "v_c")
    b1 = await _make_branch(db_session, alice, name="V3", key="VV3")
    tid = await _type_id(db_session, b1)
    fnum = await _make_field(db_session, tid, "Num", "number")
    assert await validate_custom_field_values(tid, {"99999": "x"}, db_session, strict=False) is None
    assert await validate_custom_field_values(tid, {str(fnum): "nope"}, db_session, strict=False) == ErrorCode.INVALID_CUSTOM_FIELD


async def test_validator_select_option_membership(db_session):
    alice = await _make_user(db_session, "v_d@t.test", "v_d")
    b1 = await _make_branch(db_session, alice, name="V4", key="VV4")
    tid = await _type_id(db_session, b1)
    fsel = await _make_field(db_session, tid, "Sel", "select", options=["red", "green"])
    assert await validate_custom_field_values(tid, {str(fsel): "red"}, db_session, strict=True) is None
    assert await validate_custom_field_values(tid, {str(fsel): "blue"}, db_session, strict=True) == ErrorCode.INVALID_CUSTOM_FIELD
    assert await validate_custom_field_values(tid, {str(fsel): "blue"}, db_session, strict=False) == ErrorCode.INVALID_CUSTOM_FIELD
    assert await validate_custom_field_values(tid, {str(fsel): None}, db_session, strict=True) is None
