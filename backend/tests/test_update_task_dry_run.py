"""update_task dry_run 미리보기 테스트 — DB 무변경 + 검증은 실제 write와 동일."""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task as ctrl
from routers.schema import task as schema


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id, 'username': 'tester'}))


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


async def _make_label(db, branch_id, name="L"):
    row = await db.execute(text("""
        INSERT INTO label (branch_id, label_name, color)
        VALUES (:b, :n, '#5E6AD2') RETURNING label_id
    """), {"b": branch_id, "n": name})
    return row.scalar_one()


async def test_dry_run_returns_diff_without_mutation(db_session):
    alice = await _make_user(db_session, "dr_a@t.test", "dr_a")
    b1 = await _make_branch(db_session, alice, name="DR", key="DRB")
    await _add_member(db_session, b1, alice, "admin")
    l1 = await _make_label(db_session, b1, "L1")
    l2 = await _make_label(db_session, b1, "L2")
    l3 = await _make_label(db_session, b1, "L3")
    task1 = await _make_task(db_session, b1, alice, "T1")
    await ctrl.update(task1, schema.TaskUpdate(label_ids=[l1, l2, l3]), b1, _req(alice), db_session)

    # dry_run: l3만 남기는 replace를 미리보기 → l1,l2 removed, 저장 안 됨
    body = schema.TaskUpdate(label_ids=[l3], dry_run=True)
    res = await ctrl.update(task1, body, b1, _req(alice), db_session)
    assert res["status"] is True
    assert res["dry_run"] is True
    assert set(res["changes"]["labels"]["removed"]) == {l1, l2}
    assert res["changes"]["labels"]["final"] == [l3]

    # DB는 그대로 3개
    count = (await db_session.execute(text(
        "SELECT COUNT(*) FROM task_label WHERE task_id = :t"), {"t": task1})).scalar_one()
    assert count == 3


async def test_dry_run_still_validates(db_session):
    alice = await _make_user(db_session, "dr_b@t.test", "dr_b")
    b1 = await _make_branch(db_session, alice, name="DR2", key="DRC")
    await _add_member(db_session, b1, alice, "admin")
    task1 = await _make_task(db_session, b1, alice, "T1")

    # dry_run이어도 bogus task_type은 검증 실패
    body = schema.TaskUpdate(task_type="bogus", dry_run=True)
    res = await ctrl.update(task1, body, b1, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "INVALID_TASK_TYPE"


async def test_dry_run_field_diff(db_session):
    alice = await _make_user(db_session, "dr_c@t.test", "dr_c")
    b1 = await _make_branch(db_session, alice, name="DR3", key="DRD")
    await _add_member(db_session, b1, alice, "admin")
    task1 = await _make_task(db_session, b1, alice, "T1")

    body = schema.TaskUpdate(status="done", dry_run=True)
    res = await ctrl.update(task1, body, b1, _req(alice), db_session)
    assert res["status"] is True and res["dry_run"] is True
    assert res["changes"]["fields"]["status"] == {"from": "todo", "to": "done"}
    # 저장 안 됨
    st = (await db_session.execute(text(
        "SELECT status FROM task WHERE task_id = :t"), {"t": task1})).scalar_one()
    assert st == "todo"


async def test_dry_run_assignee_role_promotion(db_session):
    """dry_run이 sub→main 같은 role-only 변경(main 교체)을 preview에 보여줘야 한다."""
    alice = await _make_user(db_session, "drp_a@t.test", "drp_a")
    bob = await _make_user(db_session, "drp_b@t.test", "drp_b")
    b1 = await _make_branch(db_session, alice, name="DRP", key="DRP")
    await _add_member(db_session, b1, alice, "admin")
    await _add_member(db_session, b1, bob, "member")
    task1 = await _make_task(db_session, b1, alice, "T1")
    await ctrl.update(task1, schema.TaskUpdate(assignees=schema.AssigneeInput(main=None, sub=[bob])),
                      b1, _req(alice), db_session)

    # dry_run: bob을 main으로 → user set은 그대로지만 main이 None→bob
    body = schema.TaskUpdate(assignees=schema.AssigneeInput(main=bob, sub=[]), dry_run=True)
    res = await ctrl.update(task1, body, b1, _req(alice), db_session)
    assert res["status"] is True and res["dry_run"] is True
    assert res["changes"]["assignees"]["main_change"] == {"from": None, "to": bob}
    # 저장 안 됨(bob은 여전히 sub)
    assert (await db_session.execute(text(
        "SELECT role FROM task_assignee WHERE task_id=:t AND user_id=:u"
    ), {"t": task1, "u": bob})).scalar_one() == "sub"
