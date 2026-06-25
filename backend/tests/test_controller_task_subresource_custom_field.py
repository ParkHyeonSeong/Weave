"""custom field 값 검증기(validate_custom_field_values) 단위 테스트.

Slice 0: 네이티브 타입 허용 / null clear / strict-unknown 거부 / lenient 무시 /
select 옵션 멤버십. 검증기는 type_id 기준으로 동작.
"""
import json
from types import SimpleNamespace

from sqlalchemy import text

from library.custom_field_validator import validate_custom_field_values
from core.model import task as task_model
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
    for key_, label, color_, category, sort in [
        ("todo", "To Do", "#9CA3AF", "todo", 0),
        ("in_progress", "In Progress", "#2563EB", "in_progress", 1),
        ("done", "Done", "#16A34A", "done", 2),
        ("cancelled", "Cancelled", "#DC2626", "cancelled", 3),
    ]:
        await db.execute(text("""
            INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order)
            VALUES (:b, :k, :l, :c, :cat, :s)
        """), {"b": bid, "k": key_, "l": label, "c": color_, "cat": category, "s": sort})
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


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id, 'username': 'tester'}))


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by, title="Task"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "u": created_by})
    return res.scalar_one()


async def test_merge_custom_field_set_and_clear(db_session):
    alice = await _make_user(db_session, "mc_a@t.test", "mc_a")
    b1 = await _make_branch(db_session, alice, name="MC", key="MCB")
    task1 = await _make_task(db_session, b1, alice, "T1")
    await db_session.execute(text(
        "UPDATE task SET custom_fields = '{\"12\": \"old\", \"13\": \"keep\"}' WHERE task_id = :t"
    ), {"t": task1})

    # 키 12만 교체 → 13 보존 (per-key merge)
    await task_model.merge_custom_field(task1, 12, "new", db_session)
    cf = (await db_session.execute(text(
        "SELECT custom_fields FROM task WHERE task_id = :t"), {"t": task1})).scalar_one()
    assert cf == {"12": "new", "13": "keep"}

    # null → 키 제거
    await task_model.merge_custom_field(task1, 12, None, db_session)
    cf = (await db_session.execute(text(
        "SELECT custom_fields FROM task WHERE task_id = :t"), {"t": task1})).scalar_one()
    assert cf == {"13": "keep"}


# ---------------------------------------------------------------------------
# Task 3.2 — set_task_custom_field controller (strict)
# ---------------------------------------------------------------------------

async def test_set_task_custom_field_strict_and_merge(db_session):
    from core.controller import task_subresource as sub
    alice = await _make_user(db_session, "sc_a@t.test", "sc_a")
    b1 = await _make_branch(db_session, alice, name="SC", key="SCB")
    await _add_member(db_session, b1, alice, "admin")
    tid = await _type_id(db_session, b1)
    fnum = await _make_field(db_session, tid, "Num", "number")
    ftext = await _make_field(db_session, tid, "Txt", "text")
    task1 = await _make_task(db_session, b1, alice, "T1")

    # text 키 세팅
    assert (await sub.set_task_custom_field(task1, ftext, "hello", b1, _req(alice), db_session))["status"] is True
    # number 키 세팅 → text 보존(merge)
    assert (await sub.set_task_custom_field(task1, fnum, 42, b1, _req(alice), db_session))["status"] is True
    cf = (await db_session.execute(text(
        "SELECT custom_fields FROM task WHERE task_id = :t"), {"t": task1})).scalar_one()
    assert cf == {str(ftext): "hello", str(fnum): 42}

    # number 필드에 문자열 → strict 거부
    res = await sub.set_task_custom_field(task1, fnum, "bad", b1, _req(alice), db_session)
    assert res["status"] is False and res["code"] == "INVALID_CUSTOM_FIELD"

    # 모르는 field_id → strict 거부
    res = await sub.set_task_custom_field(task1, 99999, "x", b1, _req(alice), db_session)
    assert res["status"] is False and res["code"] == "INVALID_CUSTOM_FIELD"

    # null clear
    assert (await sub.set_task_custom_field(task1, ftext, None, b1, _req(alice), db_session))["status"] is True
    cf = (await db_session.execute(text(
        "SELECT custom_fields FROM task WHERE task_id = :t"), {"t": task1})).scalar_one()
    assert str(ftext) not in cf


async def test_set_task_custom_field_cross_branch_task(db_session):
    from core.controller import task_subresource as sub
    alice = await _make_user(db_session, "sc_b@t.test", "sc_b")
    bob = await _make_user(db_session, "sc_c@t.test", "sc_c")
    b1 = await _make_branch(db_session, alice, name="SC2", key="SCC")
    await _add_member(db_session, b1, alice, "admin")
    b2 = await _make_branch(db_session, bob, name="SC3", key="SCD")
    tid2 = await _type_id(db_session, b2)
    f2 = await _make_field(db_session, tid2, "X", "text")
    foreign_task = await _make_task(db_session, b2, bob, "FT")

    res = await sub.set_task_custom_field(foreign_task, f2, "v", b1, _req(alice), db_session)
    assert res["status"] is False and res["code"] == "TASK_NOT_FOUND"


# ---------------------------------------------------------------------------
# Task 3.3 — create/update replace 경로 lenient 검증
# ---------------------------------------------------------------------------

async def test_update_replace_custom_fields_lenient(db_session):
    from core.controller import task as ctrl
    from routers.schema import task as schema
    alice = await _make_user(db_session, "lv_a@t.test", "lv_a")
    b1 = await _make_branch(db_session, alice, name="LV", key="LVB")
    await _add_member(db_session, b1, alice, "admin")
    tid = await _type_id(db_session, b1)
    fnum = await _make_field(db_session, tid, "Num", "number")
    task1 = await _make_task(db_session, b1, alice, "T1")

    # 알려진 number 키에 문자열 → 거부(lenient라도 타입 검증)
    body = schema.TaskUpdate(custom_fields={str(fnum): "bad"})
    res = await ctrl.update(task1, body, b1, _req(alice), db_session)
    assert res["status"] is False and res["code"] == "INVALID_CUSTOM_FIELD"

    # 모르는 키는 통과(lenient, stale 키로 UI 안 깨지게)
    body2 = schema.TaskUpdate(custom_fields={str(fnum): 5, "99999": "x"})
    res2 = await ctrl.update(task1, body2, b1, _req(alice), db_session)
    assert res2["status"] is True


async def test_create_custom_fields_lenient_rejects_bad_type_no_task(db_session):
    from core.controller import task as ctrl
    from routers.schema import task as schema
    alice = await _make_user(db_session, "lv_b@t.test", "lv_b")
    b1 = await _make_branch(db_session, alice, name="LV2", key="LVC")
    await _add_member(db_session, b1, alice, "admin")
    tid = await _type_id(db_session, b1)
    fnum = await _make_field(db_session, tid, "Num", "number")

    before = (await db_session.execute(text(
        "SELECT COUNT(*) FROM task WHERE branch_id = :b"), {"b": b1})).scalar_one()
    body = schema.TaskCreate(title="T", task_type="task", status="todo",
                             custom_fields={str(fnum): "bad"})
    res = await ctrl.create(body, b1, _req(alice), db_session)
    assert res["status"] is False and res["code"] == "INVALID_CUSTOM_FIELD"
    after = (await db_session.execute(text(
        "SELECT COUNT(*) FROM task WHERE branch_id = :b"), {"b": b1})).scalar_one()
    assert after == before  # 검증 실패 시 task 안 남음


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
