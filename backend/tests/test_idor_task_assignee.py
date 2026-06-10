"""IDOR regression tests for task assignee validation (LOG-09).

Style: direct controller-level calls (no HTTP client), seeding with raw INSERTs
via the rollback-isolated ``db_session`` fixture. See test_idor_workflow_status.py
/ test_track_home.py for the shared pattern.

Gap: task create/update accepted any user_id as assignee (main + sub) without
verifying that those users were members of the task's branch. A branch-1 admin
could assign a branch-2 user (or a non-existent user_id) as assignee, harming
data integrity and triggering inappropriate notifications. The fix validates all
assignee ids against branch membership before ``set_assignees`` and rejects the
whole request with INVALID_ASSIGNEE if any id is invalid (all-or-nothing).
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task as ctrl
from routers.schema import task as schema


def _req(user_id: int):
    """controller가 읽는 request.state.payload만 흉내낸다."""
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id, 'username': 'tester'}))


# ---------------------------------------------------------------------------
# seed helpers (raw INSERT — real schema column names)
# ---------------------------------------------------------------------------

async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Branch", key="KEY"):
    """Create a branch and seed its 4 default workflow statuses + default task_type."""
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
    # default task_type so create() passes INVALID_TASK_TYPE check
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


async def _assignee_ids(db, task_id):
    res = await db.execute(text("""
        SELECT user_id FROM task_assignee WHERE task_id = :t
    """), {"t": task_id})
    return {r[0] for r in res.fetchall()}


# ---------------------------------------------------------------------------
# update — cross-branch / non-existent assignee rejected
# ---------------------------------------------------------------------------

async def test_update_rejects_cross_branch_main_assignee(db_session):
    """branch1 admin이 branch2 사용자를 main 담당자로 지정 → INVALID_ASSIGNEE."""
    alice = await _make_user(db_session, "alice@asg.test", "alice")
    bob = await _make_user(db_session, "bob@asg.test", "bob")

    branch1 = await _make_branch(db_session, alice, name="B1", key="AB1")
    await _add_member(db_session, branch1, alice, "admin")

    branch2 = await _make_branch(db_session, bob, name="B2", key="AB2")
    await _add_member(db_session, branch2, bob, "admin")

    task1 = await _make_task(db_session, branch1, alice, "T1")

    body = schema.TaskUpdate(assignees=schema.AssigneeInput(main=bob, sub=[]))
    res = await ctrl.update(task1, body, branch1, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "INVALID_ASSIGNEE"

    # 거부됐으므로 담당자가 추가되지 않아야 한다
    assert await _assignee_ids(db_session, task1) == set()


async def test_update_rejects_cross_branch_sub_assignee(db_session):
    """main은 valid이지만 sub에 타 branch 사용자가 섞이면 전체 거부 (all-or-nothing)."""
    alice = await _make_user(db_session, "alice2@asg.test", "alice2")
    bob = await _make_user(db_session, "bob2@asg.test", "bob2")
    charlie = await _make_user(db_session, "charlie2@asg.test", "charlie2")

    branch1 = await _make_branch(db_session, alice, name="B1S", key="AB1S")
    await _add_member(db_session, branch1, alice, "admin")

    branch2 = await _make_branch(db_session, bob, name="B2S", key="AB2S")
    await _add_member(db_session, branch2, bob, "admin")
    await _add_member(db_session, branch2, charlie, "member")

    task1 = await _make_task(db_session, branch1, alice, "T1")

    body = schema.TaskUpdate(assignees=schema.AssigneeInput(main=alice, sub=[charlie]))
    res = await ctrl.update(task1, body, branch1, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "INVALID_ASSIGNEE"

    # all-or-nothing: valid한 alice도 적용되지 않아야 한다
    assert await _assignee_ids(db_session, task1) == set()


async def test_update_rejects_nonexistent_user(db_session):
    """존재하지 않는 user_id를 담당자로 지정 → INVALID_ASSIGNEE."""
    alice = await _make_user(db_session, "alice3@asg.test", "alice3")
    branch1 = await _make_branch(db_session, alice, name="B1N", key="AB1N")
    await _add_member(db_session, branch1, alice, "admin")
    task1 = await _make_task(db_session, branch1, alice, "T1")

    ghost = 99999999  # 존재하지 않는 user_id
    body = schema.TaskUpdate(assignees=schema.AssigneeInput(main=ghost, sub=[]))
    res = await ctrl.update(task1, body, branch1, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "INVALID_ASSIGNEE"
    assert await _assignee_ids(db_session, task1) == set()


# ---------------------------------------------------------------------------
# create — cross-branch assignee rejected
# ---------------------------------------------------------------------------

async def test_create_rejects_cross_branch_assignee(db_session):
    """task 생성 시 타 branch 사용자를 담당자로 지정 → INVALID_ASSIGNEE."""
    alice = await _make_user(db_session, "alice_c@asg.test", "alice_c")
    bob = await _make_user(db_session, "bob_c@asg.test", "bob_c")

    branch1 = await _make_branch(db_session, alice, name="BC1", key="ABC1")
    await _add_member(db_session, branch1, alice, "admin")

    branch2 = await _make_branch(db_session, bob, name="BC2", key="ABC2")
    await _add_member(db_session, branch2, bob, "admin")

    body = schema.TaskCreate(
        title="Cross-branch task",
        task_type="task",
        status="todo",
        priority="medium",
        assignees=schema.AssigneeInput(main=bob, sub=[]),
    )
    res = await ctrl.create(body, branch1, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "INVALID_ASSIGNEE"


# ---------------------------------------------------------------------------
# regression — same-branch happy paths still work
# ---------------------------------------------------------------------------

async def test_update_same_branch_multiple_assignees_ok(db_session):
    """같은 branch 멤버 여러 명(main + sub)을 지정하는 정상 케이스는 동작."""
    alice = await _make_user(db_session, "alice_ok@asg.test", "alice_ok")
    bob = await _make_user(db_session, "bob_ok@asg.test", "bob_ok")
    carol = await _make_user(db_session, "carol_ok@asg.test", "carol_ok")

    branch1 = await _make_branch(db_session, alice, name="BOK", key="ABOK")
    await _add_member(db_session, branch1, alice, "admin")
    await _add_member(db_session, branch1, bob, "member")
    await _add_member(db_session, branch1, carol, "member")

    task1 = await _make_task(db_session, branch1, alice, "T1")

    body = schema.TaskUpdate(assignees=schema.AssigneeInput(main=alice, sub=[bob, carol]))
    res = await ctrl.update(task1, body, branch1, _req(alice), db_session)
    assert res["status"] is True
    assert await _assignee_ids(db_session, task1) == {alice, bob, carol}


async def test_update_clear_assignees_ok(db_session):
    """담당자 없음(빈)은 정상 — 기존 담당자 해제가 깨지지 않아야 한다."""
    alice = await _make_user(db_session, "alice_clr@asg.test", "alice_clr")
    bob = await _make_user(db_session, "bob_clr@asg.test", "bob_clr")

    branch1 = await _make_branch(db_session, alice, name="BCLR", key="ABCLR")
    await _add_member(db_session, branch1, alice, "admin")
    await _add_member(db_session, branch1, bob, "member")

    task1 = await _make_task(db_session, branch1, alice, "T1")

    # 먼저 담당자 지정
    set_body = schema.TaskUpdate(assignees=schema.AssigneeInput(main=alice, sub=[bob]))
    res = await ctrl.update(task1, set_body, branch1, _req(alice), db_session)
    assert res["status"] is True
    assert await _assignee_ids(db_session, task1) == {alice, bob}

    # 이제 담당자 해제 (빈 지정)
    clear_body = schema.TaskUpdate(assignees=schema.AssigneeInput(main=None, sub=[]))
    res = await ctrl.update(task1, clear_body, branch1, _req(alice), db_session)
    assert res["status"] is True
    assert await _assignee_ids(db_session, task1) == set()


async def test_create_same_branch_assignee_ok(db_session):
    """task 생성 시 같은 branch 멤버를 담당자로 지정 → 정상."""
    alice = await _make_user(db_session, "alice_co@asg.test", "alice_co")
    bob = await _make_user(db_session, "bob_co@asg.test", "bob_co")

    branch1 = await _make_branch(db_session, alice, name="BCO", key="ABCO")
    await _add_member(db_session, branch1, alice, "admin")
    await _add_member(db_session, branch1, bob, "member")

    body = schema.TaskCreate(
        title="OK task",
        task_type="task",
        status="todo",
        priority="medium",
        assignees=schema.AssigneeInput(main=alice, sub=[bob]),
    )
    res = await ctrl.create(body, branch1, _req(alice), db_session)
    assert res["status"] is True
    assert await _assignee_ids(db_session, res["task_id"]) == {alice, bob}
