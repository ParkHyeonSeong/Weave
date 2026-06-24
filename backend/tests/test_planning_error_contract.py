"""Error-contract tests for the planning cluster (epic + sprint controllers).

Proves that after migration every failure return carries code/category/retryable
in addition to the legacy message (dual-emit: message == code).

Style: direct controller-function calls, SimpleNamespace req, raw sqlalchemy
text() INSERTs cribbed verbatim from test_epic_date_validation.py and
test_sprint_date_validation.py / test_idor_sprint_complete.py.
One representative error-path test per category present in the cluster.
"""
from datetime import date
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import epic as epic_ctrl
from core.controller import sprint as sprint_ctrl
from routers.schema import epic as epic_schema
from routers.schema import sprint as sprint_schema


# ---------------------------------------------------------------------------
# helpers (cribbed verbatim from test_epic_date_validation.py and
# test_sprint_date_validation.py / test_idor_sprint_complete.py)
# ---------------------------------------------------------------------------

def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id, 'username': 'u'}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, key):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES ('B', :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"k": key, "u": created_by})
    return row.scalar_one()


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_epic(db, branch_id, created_by, start=None, due=None):
    row = await db.execute(text("""
        INSERT INTO epic (branch_id, epic_name, color, created_by, start_date, due_date)
        VALUES (:b, 'E', '#5E6AD2', :u, :s, :d) RETURNING epic_id
    """), {"b": branch_id, "u": created_by, "s": start, "d": due})
    return row.scalar_one()


async def _make_sprint(db, branch_id, created_by, start=None, end=None, status="future"):
    row = await db.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, goal, created_by, status, start_date, end_date)
        VALUES (:b, 'S', 'g', :u, :st, :s, :e) RETURNING sprint_id
    """), {"b": branch_id, "u": created_by, "st": status, "s": start, "e": end})
    return row.scalar_one()


async def _make_task(db, branch_id, created_by, sprint_id=None, status="todo"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by, sprint_id)
        VALUES (:b, :dn, 'T', :st, :u, :s) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "st": status, "u": created_by, "s": sprint_id})
    return res.scalar_one()


# ---------------------------------------------------------------------------
# CATEGORY: forbidden  (NOT_BRANCH_MEMBER)
# Covers: epic.create, get_list, get_detail, update, get_tasks, reorder, delete
#         sprint.create, get_list, update, delete, start, complete, reorder, get_task_counts
# ---------------------------------------------------------------------------

async def test_epic_not_branch_member_is_forbidden(db_session):
    """Non-member calling epic.create → NOT_BRANCH_MEMBER with forbidden category."""
    alice = await _make_user(db_session, "alice_epic_nbm@p.test", "alice_epic_nbm")
    outsider = await _make_user(db_session, "out_epic_nbm@p.test", "out_epic_nbm")
    branch = await _make_branch(db_session, alice, "PENBM1")
    await _add_member(db_session, branch, alice)
    # outsider is NOT added as a member
    body = epic_schema.EpicCreate(epic_name='X')
    res = await epic_ctrl.create(body, branch, _req(outsider), db_session)
    assert res["status"] is False
    assert res["code"] == "NOT_BRANCH_MEMBER"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


async def test_sprint_not_branch_member_is_forbidden(db_session):
    """Non-member calling sprint.get_list → NOT_BRANCH_MEMBER with forbidden category."""
    alice = await _make_user(db_session, "alice_spr_nbm@p.test", "alice_spr_nbm")
    outsider = await _make_user(db_session, "out_spr_nbm@p.test", "out_spr_nbm")
    branch = await _make_branch(db_session, alice, "PSNBM1")
    await _add_member(db_session, branch, alice)
    res = await sprint_ctrl.get_list(branch, _req(outsider), db_session)
    assert res["status"] is False
    assert res["code"] == "NOT_BRANCH_MEMBER"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


# ---------------------------------------------------------------------------
# CATEGORY: not_found  (EPIC_NOT_FOUND, SPRINT_NOT_FOUND, TARGET_SPRINT_NOT_FOUND)
# ---------------------------------------------------------------------------

async def test_epic_not_found(db_session):
    """get_detail with nonexistent epic_id → EPIC_NOT_FOUND with not_found category."""
    alice = await _make_user(db_session, "alice_enf@p.test", "alice_enf")
    branch = await _make_branch(db_session, alice, "PENF1")
    await _add_member(db_session, branch, alice)
    res = await epic_ctrl.get_detail(999999, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "EPIC_NOT_FOUND"
    assert res["category"] == "not_found"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


async def test_sprint_not_found(db_session):
    """sprint.delete with nonexistent sprint_id → SPRINT_NOT_FOUND with not_found category."""
    alice = await _make_user(db_session, "alice_snf@p.test", "alice_snf")
    branch = await _make_branch(db_session, alice, "PSNF1")
    await _add_member(db_session, branch, alice)
    res = await sprint_ctrl.delete(999999, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "SPRINT_NOT_FOUND"
    assert res["category"] == "not_found"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


async def test_target_sprint_not_found(db_session):
    """sprint.complete with cross-branch target → TARGET_SPRINT_NOT_FOUND with not_found category."""
    alice = await _make_user(db_session, "alice_tsnf@p.test", "alice_tsnf")
    bob = await _make_user(db_session, "bob_tsnf@p.test", "bob_tsnf")
    branch1 = await _make_branch(db_session, alice, "PTSNF1")
    branch2 = await _make_branch(db_session, bob, "PTSNF2")
    await _add_member(db_session, branch1, alice)
    await _add_member(db_session, branch2, bob)
    sprint1 = await _make_sprint(db_session, branch1, alice, status="active")
    sprint2 = await _make_sprint(db_session, branch2, bob, status="future")
    await _make_task(db_session, branch1, alice, sprint_id=sprint1, status="todo")
    res = await sprint_ctrl.complete(
        sprint1,
        sprint_schema.SprintComplete(move_to=str(sprint2)),
        branch1, _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["code"] == "TARGET_SPRINT_NOT_FOUND"
    assert res["category"] == "not_found"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


# ---------------------------------------------------------------------------
# CATEGORY: validation  (INVALID_DATE_RANGE, INVALID_MOVE_TARGET)
# ---------------------------------------------------------------------------

async def test_epic_invalid_date_range(db_session):
    """epic.create with start > due → INVALID_DATE_RANGE with validation category."""
    alice = await _make_user(db_session, "alice_eidr@p.test", "alice_eidr")
    branch = await _make_branch(db_session, alice, "PEIDR1")
    await _add_member(db_session, branch, alice)
    body = epic_schema.EpicCreate(epic_name='E', start_date=date(2026, 6, 25), due_date=date(2026, 6, 18))
    res = await epic_ctrl.create(body, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "INVALID_DATE_RANGE"
    assert res["category"] == "validation"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


async def test_sprint_invalid_date_range(db_session):
    """sprint.create with start > end → INVALID_DATE_RANGE with validation category."""
    alice = await _make_user(db_session, "alice_sidr@p.test", "alice_sidr")
    branch = await _make_branch(db_session, alice, "PSIDR1")
    await _add_member(db_session, branch, alice)
    body = sprint_schema.SprintCreate(sprint_name='S', start_date=date(2026, 6, 25), end_date=date(2026, 6, 18))
    res = await sprint_ctrl.create(body, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "INVALID_DATE_RANGE"
    assert res["category"] == "validation"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


async def test_sprint_invalid_move_target(db_session):
    """sprint.complete with non-numeric move_to → INVALID_MOVE_TARGET with validation category."""
    alice = await _make_user(db_session, "alice_imt@p.test", "alice_imt")
    branch = await _make_branch(db_session, alice, "PIMT1")
    await _add_member(db_session, branch, alice)
    sprint = await _make_sprint(db_session, branch, alice, status="active")
    await _make_task(db_session, branch, alice, sprint_id=sprint, status="todo")
    res = await sprint_ctrl.complete(
        sprint,
        sprint_schema.SprintComplete(move_to="not-a-number"),
        branch, _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["code"] == "INVALID_MOVE_TARGET"
    assert res["category"] == "validation"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


# ---------------------------------------------------------------------------
# CATEGORY: business  (SPRINT_NOT_FUTURE, SPRINT_EMPTY, SPRINT_NOT_ACTIVE)
# ---------------------------------------------------------------------------

async def test_sprint_not_future(db_session):
    """sprint.start on an already-active sprint → SPRINT_NOT_FUTURE with business category."""
    alice = await _make_user(db_session, "alice_snfu@p.test", "alice_snfu")
    branch = await _make_branch(db_session, alice, "PSNFU1")
    await _add_member(db_session, branch, alice)
    sprint = await _make_sprint(db_session, branch, alice, status="active")
    res = await sprint_ctrl.start(sprint, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "SPRINT_NOT_FUTURE"
    assert res["category"] == "business"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


async def test_sprint_empty(db_session):
    """sprint.start on a future sprint with no tasks → SPRINT_EMPTY with business category."""
    alice = await _make_user(db_session, "alice_se@p.test", "alice_se")
    branch = await _make_branch(db_session, alice, "PSE1")
    await _add_member(db_session, branch, alice)
    sprint = await _make_sprint(db_session, branch, alice, status="future")
    # No tasks added — sprint is empty
    res = await sprint_ctrl.start(sprint, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "SPRINT_EMPTY"
    assert res["category"] == "business"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


async def test_sprint_not_active(db_session):
    """sprint.complete on a future sprint → SPRINT_NOT_ACTIVE with business category."""
    alice = await _make_user(db_session, "alice_sna@p.test", "alice_sna")
    branch = await _make_branch(db_session, alice, "PSNA1")
    await _add_member(db_session, branch, alice)
    sprint = await _make_sprint(db_session, branch, alice, status="future")
    res = await sprint_ctrl.complete(
        sprint,
        sprint_schema.SprintComplete(move_to="backlog"),
        branch, _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["code"] == "SPRINT_NOT_ACTIVE"
    assert res["category"] == "business"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit
