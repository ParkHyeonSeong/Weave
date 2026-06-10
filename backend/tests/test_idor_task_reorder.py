"""IDOR regression tests for task reorder / sprint-move (LOG-05).

Style: direct controller-level calls (no HTTP client), seeding with raw INSERTs
via the rollback-isolated ``db_session`` fixture. See test_track_home.py /
test_idor_workflow_status.py for the shared pattern.

Gap: ``task.reorder`` checked only branch membership and never verified that
the target ``sprint_id`` (or referenced ``after_task_id``) belonged to that
branch — a branch-1 member could move a branch-1 task into a branch-2 sprint by
supplying a foreign sprint_id (cross-branch IDOR). The canonical safe pattern
uses ``core.guard.branch_scope.find_resource_in_branch``.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task as ctrl
from routers.schema import task as schema


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
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    return row.scalar_one()


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_sprint(db, branch_id, created_by, name="Sprint 1"):
    row = await db.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, goal, created_by, status)
        VALUES (:b, :n, 'goal', :u, 'active') RETURNING sprint_id
    """), {"b": branch_id, "n": name, "u": created_by})
    return row.scalar_one()


async def _make_task(db, branch_id, created_by, sprint_id=None, title="Task"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by, sprint_id)
        VALUES (:b, :dn, :t, 'todo', :u, :s) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "u": created_by, "s": sprint_id})
    return res.scalar_one()


async def _task_sprint(db, task_id):
    res = await db.execute(text("""
        SELECT sprint_id FROM task WHERE task_id = :t
    """), {"t": task_id})
    return res.scalar_one()


async def _task_sort_order(db, task_id):
    res = await db.execute(text("""
        SELECT sort_order FROM task WHERE task_id = :t
    """), {"t": task_id})
    return res.scalar_one()


async def _set_sort_order(db, task_id, sort_order):
    await db.execute(text("""
        UPDATE task SET sort_order = :s WHERE task_id = :t
    """), {"s": sort_order, "t": task_id})


# ---------------------------------------------------------------------------
# reorder — cross-branch sprint IDOR
# ---------------------------------------------------------------------------

async def test_reorder_rejects_cross_branch_sprint(db_session):
    """branch-1 멤버가 branch-1 task를 branch-2 sprint로 이동 시도 → SPRINT_NOT_FOUND."""
    alice = await _make_user(db_session, "alice_reorder@idor.test", "alice_reorder")
    bob = await _make_user(db_session, "bob_reorder@idor.test", "bob_reorder")

    branch1 = await _make_branch(db_session, alice, name="B1", key="RIDB1")
    await _add_member(db_session, branch1, alice, "member")
    sprint1 = await _make_sprint(db_session, branch1, alice, name="S1")
    task1 = await _make_task(db_session, branch1, alice, sprint_id=sprint1, title="T1")

    branch2 = await _make_branch(db_session, bob, name="B2", key="RIDB2")
    await _add_member(db_session, branch2, bob, "admin")
    sprint2 = await _make_sprint(db_session, branch2, bob, name="S2")

    body = schema.TaskReorder(task_ids=[task1], sprint_id=sprint2, after_task_id=None)
    res = await ctrl.reorder(body, branch1, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "SPRINT_NOT_FOUND"

    # task1은 여전히 sprint1에 있어야 한다 (이동 미발생)
    assert await _task_sprint(db_session, task1) == sprint1


async def test_reorder_rejects_cross_branch_after_task(db_session):
    """after_task_id가 타 branch task면 거부 → AFTER_TASK_NOT_FOUND."""
    alice = await _make_user(db_session, "alice_after@idor.test", "alice_after")
    bob = await _make_user(db_session, "bob_after@idor.test", "bob_after")

    branch1 = await _make_branch(db_session, alice, name="B1", key="RAFB1")
    await _add_member(db_session, branch1, alice, "member")
    sprint1 = await _make_sprint(db_session, branch1, alice, name="S1")
    task1 = await _make_task(db_session, branch1, alice, sprint_id=sprint1, title="T1")

    branch2 = await _make_branch(db_session, bob, name="B2", key="RAFB2")
    await _add_member(db_session, branch2, bob, "admin")
    sprint2 = await _make_sprint(db_session, branch2, bob, name="S2")
    task2 = await _make_task(db_session, branch2, bob, sprint_id=sprint2, title="T2")

    body = schema.TaskReorder(task_ids=[task1], sprint_id=sprint1, after_task_id=task2)
    res = await ctrl.reorder(body, branch1, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "AFTER_TASK_NOT_FOUND"


async def test_reorder_rejects_cross_branch_task_ids(db_session):
    """branch-1 멤버가 task_ids에 branch-2 task를 넣어 sort_order를 덮어쓰려는
    시도 → TASK_NOT_FOUND, 그리고 branch-2 task의 sort_order는 불변 (no mutation).
    sprint_id=None(백로그) 케이스에서도 막혀야 한다."""
    alice = await _make_user(db_session, "alice_xtid@idor.test", "alice_xtid")
    bob = await _make_user(db_session, "bob_xtid@idor.test", "bob_xtid")

    branch1 = await _make_branch(db_session, alice, name="B1", key="RXTB1")
    await _add_member(db_session, branch1, alice, "member")

    branch2 = await _make_branch(db_session, bob, name="B2", key="RXTB2")
    await _add_member(db_session, branch2, bob, "admin")
    foreign = await _make_task(db_session, branch2, bob, sprint_id=None, title="Foreign")
    await _set_sort_order(db_session, foreign, 7)

    body = schema.TaskReorder(task_ids=[foreign], sprint_id=None, after_task_id=None)
    res = await ctrl.reorder(body, branch1, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "TASK_NOT_FOUND"

    # branch-2 task는 건드려지지 않아야 한다 (sort_order 불변)
    assert await _task_sort_order(db_session, foreign) == 7


# ---------------------------------------------------------------------------
# regression — legitimate cases must keep working
# ---------------------------------------------------------------------------

async def test_reorder_to_backlog_succeeds(db_session):
    """sprint_id=None(백로그 이동)이면 검증을 건너뛰고 정상 통과."""
    alice = await _make_user(db_session, "alice_bl@idor.test", "alice_bl")
    branch1 = await _make_branch(db_session, alice, name="B1", key="RBLB1")
    await _add_member(db_session, branch1, alice, "member")
    sprint1 = await _make_sprint(db_session, branch1, alice, name="S1")
    task1 = await _make_task(db_session, branch1, alice, sprint_id=sprint1, title="T1")

    body = schema.TaskReorder(task_ids=[task1], sprint_id=None, after_task_id=None)
    res = await ctrl.reorder(body, branch1, _req(alice), db_session)
    assert res["status"] is True

    # 실제로 백로그(sprint_id NULL)로 이동했는지 확인
    assert await _task_sprint(db_session, task1) is None


async def test_reorder_same_branch_sprint_succeeds(db_session):
    """같은 branch sprint로의 이동은 정상 성공."""
    alice = await _make_user(db_session, "alice_ok@idor.test", "alice_ok")
    branch1 = await _make_branch(db_session, alice, name="B1", key="RSBOK1")
    await _add_member(db_session, branch1, alice, "member")
    sprint_a = await _make_sprint(db_session, branch1, alice, name="SA")
    sprint_b = await _make_sprint(db_session, branch1, alice, name="SB")
    task1 = await _make_task(db_session, branch1, alice, sprint_id=sprint_a, title="T1")

    body = schema.TaskReorder(task_ids=[task1], sprint_id=sprint_b, after_task_id=None)
    res = await ctrl.reorder(body, branch1, _req(alice), db_session)
    assert res["status"] is True

    assert await _task_sprint(db_session, task1) == sprint_b
