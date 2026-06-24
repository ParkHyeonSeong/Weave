"""Error-contract tests for the schedule cluster controllers.

Verifies that after the SP-2 migration each failure return carries
code / category / message (dual-emit) per the unified error contract.

Direct controller-call style; seed helpers cribbed verbatim from
test_controller_dependency_errors.py (_make_user, _make_branch, _add_member,
_make_task) and test_soft_delete_filter.py (schedule_event INSERT shape).
Rollback-isolated db_session fixture (no commit).
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import schedule_event as event_ctrl
from core.controller import schedule_event_task as event_task_ctrl


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id, "username": "u"}))


def _create_body(title="Event", start="2026-07-01", end="2026-07-01"):
    return SimpleNamespace(
        title=title,
        description="",
        start_date=start,
        end_date=end,
        color=None,
        participant_ids=None,
    )


def _link_body(task_id: int):
    return SimpleNamespace(task_id=task_id)


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, owner, key):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, '', 'private', '#000000', :o) RETURNING branch_id
    """), {"n": key, "k": key, "o": owner})
    return row.scalar_one()


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by):
    dn = (await db.execute(text(
        "SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b"
    ), {"b": branch_id})).scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, 'T', 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "u": created_by})
    return res.scalar_one()


async def _make_event(db, branch_id, created_by):
    row = await db.execute(text("""
        INSERT INTO schedule_event (branch_id, title, description, start_date, end_date, color, created_by)
        VALUES (:b, 'E', '', '2026-07-01', '2026-07-01', '#5E6AD2', :u) RETURNING schedule_event_id
    """), {"b": branch_id, "u": created_by})
    return row.scalar_one()


# ---------------------------------------------------------------------------
# tests — one per category present in this cluster
# ---------------------------------------------------------------------------

async def test_non_member_create_event_gets_forbidden(db_session):
    """NOT_BRANCH_MEMBER → category=forbidden (schedule_event.create)."""
    stranger = await _make_user(db_session, "sce_str@s.test", "sce_str")
    branch = await _make_branch(db_session, stranger, "SCE1")
    # stranger is NOT added as branch_member

    res = await event_ctrl.create(_create_body(), branch, _req(stranger), db_session)

    assert res["status"] is False
    assert res["code"] == "NOT_BRANCH_MEMBER"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]   # dual-emit


async def test_event_not_found_gets_not_found(db_session):
    """EVENT_NOT_FOUND → category=not_found (schedule_event.update with unknown event)."""
    alice = await _make_user(db_session, "sce_nf@s.test", "sce_nf")
    branch = await _make_branch(db_session, alice, "SCE2")
    await _add_member(db_session, branch, alice)

    body = SimpleNamespace(
        title="X", description=None, start_date=None, end_date=None, color=None,
        participant_ids=None,
        model_dump=lambda exclude_none=False: {},
    )
    res = await event_ctrl.update(999999, body, branch, _req(alice), db_session)

    assert res["status"] is False
    assert res["code"] == "EVENT_NOT_FOUND"
    assert res["category"] == "not_found"
    assert res["retryable"] is False
    assert res["message"] == res["code"]   # dual-emit


async def test_already_linked_gets_conflict(db_session):
    """ALREADY_LINKED → category=conflict (schedule_event_task.link_task duplicate)."""
    alice = await _make_user(db_session, "sce_dup@s.test", "sce_dup")
    branch = await _make_branch(db_session, alice, "SCE3")
    await _add_member(db_session, branch, alice)
    task_id = await _make_task(db_session, branch, alice)
    event_id = await _make_event(db_session, branch, alice)

    # First link succeeds
    res1 = await event_task_ctrl.link_task(
        _link_body(task_id), branch, event_id, _req(alice), db_session
    )
    assert res1["status"] is True

    # Second link on same (event_id, task_id) → unique constraint → ALREADY_LINKED
    res2 = await event_task_ctrl.link_task(
        _link_body(task_id), branch, event_id, _req(alice), db_session
    )
    assert res2["status"] is False
    assert res2["code"] == "ALREADY_LINKED"
    assert res2["category"] == "conflict"
    assert res2["retryable"] is False
    assert res2["message"] == res2["code"]   # dual-emit
