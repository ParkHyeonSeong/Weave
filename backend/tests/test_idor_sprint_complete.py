"""IDOR regression tests for sprint completion carry-over (LOG-06).

Style: direct controller-level calls (no HTTP client), seeding with raw INSERTs
via the rollback-isolated ``db_session`` fixture. See test_idor_workflow_status.py
/ test_idor_task_reorder.py for the shared pattern.

Gap: ``complete`` carried incomplete tasks to a target sprint
(``body.move_to`` = sprint_id string) without verifying that the target sprint
belonged to the request branch — a branch-1 member could move branch-1 tasks
into another branch's sprint (cross-branch IDOR). The fix verifies the target
sprint via ``find_resource_in_branch`` before moving. ``move_to == 'backlog'``
(or default) skips the check (moving to backlog is in-branch and legitimate).
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import sprint as ctrl
from routers.schema import sprint as schema


def _req(user_id: int):
    """controller가 읽는 request.state.payload만 흉내낸다."""
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


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
    """Create a branch and seed its 4 default workflow statuses."""
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
    return bid


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_sprint(db, branch_id, created_by, name="Sprint", status="active"):
    row = await db.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, goal, created_by, status)
        VALUES (:b, :n, 'goal', :u, :s) RETURNING sprint_id
    """), {"b": branch_id, "n": name, "u": created_by, "s": status})
    return row.scalar_one()


async def _make_task(db, branch_id, created_by, sprint_id=None, status="todo", title="Task"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by, sprint_id)
        VALUES (:b, :dn, :t, :st, :u, :s) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "st": status, "u": created_by, "s": sprint_id})
    return res.scalar_one()


async def _task_sprint(db, task_id):
    res = await db.execute(text("""
        SELECT sprint_id FROM task WHERE task_id = :t
    """), {"t": task_id})
    return res.scalar_one()


async def _sprint_status(db, sprint_id):
    res = await db.execute(text("""
        SELECT status FROM sprint WHERE sprint_id = :s
    """), {"s": sprint_id})
    return res.scalar_one()


# ---------------------------------------------------------------------------
# complete — cross-branch IDOR on carry-over target
# ---------------------------------------------------------------------------

async def test_complete_rejects_cross_branch_target_sprint(db_session):
    """branch-1 admin이 미완료 task를 branch-2의 sprint로 이월 시도 → 거부 + 변경 없음."""
    alice = await _make_user(db_session, "alice_sc@idor.test", "alice_sc")
    bob = await _make_user(db_session, "bob_sc@idor.test", "bob_sc")

    branch1 = await _make_branch(db_session, alice, name="B1", key="SCB1")
    await _add_member(db_session, branch1, alice, "admin")

    branch2 = await _make_branch(db_session, bob, name="B2", key="SCB2")
    await _add_member(db_session, branch2, bob, "admin")

    # branch1: 완료 대상 active sprint + 미완료 task
    sprint1 = await _make_sprint(db_session, branch1, alice, name="S1", status="active")
    task1 = await _make_task(db_session, branch1, alice, sprint_id=sprint1, status="todo")

    # branch2: 공격 대상 sprint (alice 접근 불가)
    sprint2 = await _make_sprint(db_session, branch2, bob, name="S2", status="active")

    # IDOR 시도: alice가 branch1 컨텍스트에서 task를 branch2의 sprint2로 이월
    res = await ctrl.complete(
        sprint1,
        schema.SprintComplete(move_to=str(sprint2)),
        branch1, _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "TARGET_SPRINT_NOT_FOUND"

    # task는 여전히 sprint1에 있어야 한다 (이월되지 않음)
    assert await _task_sprint(db_session, task1) == sprint1
    # 완료 대상 sprint1도 active 상태 그대로여야 한다 (거부로 인해 미변경)
    assert await _sprint_status(db_session, sprint1) == "active"


# ---------------------------------------------------------------------------
# regression — backlog carry-over still allowed
# ---------------------------------------------------------------------------

async def test_complete_backlog_carryover_succeeds(db_session):
    """move_to='backlog'면 sprint id 검증을 건너뛰고 backlog(sprint_id=None)로 이월."""
    alice = await _make_user(db_session, "alice_bl@idor.test", "alice_bl")
    branch1 = await _make_branch(db_session, alice, name="B1", key="BLB1")
    await _add_member(db_session, branch1, alice, "member")

    sprint1 = await _make_sprint(db_session, branch1, alice, name="S1", status="active")
    task1 = await _make_task(db_session, branch1, alice, sprint_id=sprint1, status="todo")

    res = await ctrl.complete(
        sprint1,
        schema.SprintComplete(move_to="backlog"),
        branch1, _req(alice), db_session,
    )
    assert res["status"] is True
    assert res["moved_count"] == 1

    # backlog = sprint_id None
    assert await _task_sprint(db_session, task1) is None
    assert await _sprint_status(db_session, sprint1) == "closed"


# ---------------------------------------------------------------------------
# regression — same-branch sprint carry-over still allowed
# ---------------------------------------------------------------------------

async def test_complete_same_branch_target_succeeds(db_session):
    """같은 branch의 다른 sprint로의 이월은 정상 허용."""
    alice = await _make_user(db_session, "alice_sb@idor.test", "alice_sb")
    branch1 = await _make_branch(db_session, alice, name="B1", key="SBB1")
    await _add_member(db_session, branch1, alice, "member")

    sprint1 = await _make_sprint(db_session, branch1, alice, name="S1", status="active")
    sprint_next = await _make_sprint(db_session, branch1, alice, name="S-next", status="future")
    task1 = await _make_task(db_session, branch1, alice, sprint_id=sprint1, status="todo")

    res = await ctrl.complete(
        sprint1,
        schema.SprintComplete(move_to=str(sprint_next)),
        branch1, _req(alice), db_session,
    )
    assert res["status"] is True
    assert res["moved_count"] == 1

    # task가 같은 branch의 sprint_next로 이월돼야 한다
    assert await _task_sprint(db_session, task1) == sprint_next
    assert await _sprint_status(db_session, sprint1) == "closed"
