"""Task 라벨 replace 경로(create/update) branch 소속 검증 + 중복 제거 테스트.

Style: direct controller-level calls, raw-INSERT seeding, rollback-isolated
db_session. test_idor_task_assignee.py 패턴 복제.
"""
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
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
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


# ---------------------------------------------------------------------------
# Task 0.2 — label branch validation + dedupe (replace path)
# ---------------------------------------------------------------------------

async def test_update_rejects_cross_branch_label(db_session):
    alice = await _make_user(db_session, "lbl_a@t.test", "lbl_a")
    bob = await _make_user(db_session, "lbl_b@t.test", "lbl_b")
    b1 = await _make_branch(db_session, alice, name="B1", key="LBA")
    await _add_member(db_session, b1, alice, "admin")
    b2 = await _make_branch(db_session, bob, name="B2", key="LBB")
    foreign_label = await _make_label(db_session, b2, "Foreign")
    task1 = await _make_task(db_session, b1, alice, "T1")

    body = schema.TaskUpdate(label_ids=[foreign_label])
    res = await ctrl.update(task1, body, b1, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "LABEL_NOT_FOUND"


async def test_update_dedupes_duplicate_label_ids(db_session):
    alice = await _make_user(db_session, "lbl_c@t.test", "lbl_c")
    b1 = await _make_branch(db_session, alice, name="B3", key="LBC")
    await _add_member(db_session, b1, alice, "admin")
    label = await _make_label(db_session, b1, "Dup")
    task1 = await _make_task(db_session, b1, alice, "T1")

    body = schema.TaskUpdate(label_ids=[label, label])
    res = await ctrl.update(task1, body, b1, _req(alice), db_session)
    assert res["status"] is True
    count = (await db_session.execute(text(
        "SELECT COUNT(*) FROM task_label WHERE task_id = :t"
    ), {"t": task1})).scalar_one()
    assert count == 1


async def test_create_with_foreign_label_leaves_no_task(db_session):
    """create의 라벨 검증은 task insert 전이라, 실패 시 task가 남지 않아야 한다."""
    alice = await _make_user(db_session, "lbl_d@t.test", "lbl_d")
    bob = await _make_user(db_session, "lbl_e@t.test", "lbl_e")
    b1 = await _make_branch(db_session, alice, name="B4", key="LBD")
    await _add_member(db_session, b1, alice, "admin")
    b2 = await _make_branch(db_session, bob, name="B5", key="LBE")
    foreign_label = await _make_label(db_session, b2, "Foreign")

    before = (await db_session.execute(text(
        "SELECT COUNT(*) FROM task WHERE branch_id = :b"), {"b": b1})).scalar_one()
    body = schema.TaskCreate(title="T", task_type="task", status="todo", label_ids=[foreign_label])
    res = await ctrl.create(body, b1, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "LABEL_NOT_FOUND"
    after = (await db_session.execute(text(
        "SELECT COUNT(*) FROM task WHERE branch_id = :b"), {"b": b1})).scalar_one()
    assert after == before


# ---------------------------------------------------------------------------
# Task 0.3 — update task_type validation + assignee sub-dedupe (main wins)
# ---------------------------------------------------------------------------

async def test_update_rejects_bogus_task_type(db_session):
    alice = await _make_user(db_session, "tt_a@t.test", "tt_a")
    b1 = await _make_branch(db_session, alice, name="TT", key="TTB")
    await _add_member(db_session, b1, alice, "admin")
    task1 = await _make_task(db_session, b1, alice, "T1")

    body = schema.TaskUpdate(task_type="bogus")
    res = await ctrl.update(task1, body, b1, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "INVALID_TASK_TYPE"


async def test_update_assignee_main_in_sub_dedupes_main_wins(db_session):
    alice = await _make_user(db_session, "as_a@t.test", "as_a")
    b1 = await _make_branch(db_session, alice, name="AS", key="ASB")
    await _add_member(db_session, b1, alice, "admin")
    task1 = await _make_task(db_session, b1, alice, "T1")

    # alice를 main과 sub 양쪽에 → main 우선, sub에서 드롭, PK 위반 500 없음
    body = schema.TaskUpdate(assignees=schema.AssigneeInput(main=alice, sub=[alice]))
    res = await ctrl.update(task1, body, b1, _req(alice), db_session)
    assert res["status"] is True
    rows = (await db_session.execute(text(
        "SELECT role FROM task_assignee WHERE task_id = :t AND user_id = :u"
    ), {"t": task1, "u": alice})).fetchall()
    assert len(rows) == 1
    assert rows[0][0] == "main"


async def test_create_assignee_main_in_sub_dedupes_main_wins(db_session):
    """create도 main이 sub에 겹칠 때 PK 위반 500 없이 main 우선으로 처리."""
    alice = await _make_user(db_session, "cas_a@t.test", "cas_a")
    b1 = await _make_branch(db_session, alice, name="CAS", key="CASB")
    await _add_member(db_session, b1, alice, "admin")
    body = schema.TaskCreate(title="T", task_type="task", status="todo",
                             assignees=schema.AssigneeInput(main=alice, sub=[alice]))
    res = await ctrl.create(body, b1, _req(alice), db_session)
    assert res["status"] is True
    rows = (await db_session.execute(text(
        "SELECT role FROM task_assignee WHERE task_id = :t AND user_id = :u"
    ), {"t": res["task_id"], "u": alice})).fetchall()
    assert len(rows) == 1
    assert rows[0][0] == "main"
