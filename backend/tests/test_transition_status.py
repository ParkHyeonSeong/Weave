"""transition_status — DB-level compare-and-swap (CAS) for GitHub auto-transition.

Style: model-level calls, raw-INSERT seeding via the rollback-isolated db_session
fixture (see tests/test_idor_ref_status.py for the shared pattern).

transition_status moves a task's status ONLY when its current status is in
allowed_current_keys, in a single conditional UPDATE ... WHERE status = ANY(:keys)
RETURNING task_id. This is the primitive the forward-only auto-transition relies on:
it never overwrites a status a human already moved out of the allowed set.
"""
from sqlalchemy import text

from core.model import task as task_model


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
    return bid


async def _make_task(db, branch_id, created_by, status="todo"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, 'T', :s, :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "s": status, "u": created_by})
    return res.scalar_one()


async def _status(db, task_id):
    row = await db.execute(text("SELECT status FROM task WHERE task_id = :t"), {"t": task_id})
    return row.scalar_one()


async def test_transition_status_moves_when_current_allowed(db_session):
    """현재 status가 allowed에 있으면 target_key로 이동하고 task_id를 반환한다."""
    u = await _make_user(db_session, "ts1@trans.test", "ts1")
    b = await _make_branch(db_session, u, key="TSA")
    t = await _make_task(db_session, b, u, status="todo")

    moved = await task_model.transition_status(t, "in_progress", ["todo"], db_session)
    assert moved == t
    assert await _status(db_session, t) == "in_progress"


async def test_transition_status_noop_when_current_not_allowed(db_session):
    """현재 status가 allowed에 없으면 None을 반환하고 status를 건드리지 않는다."""
    u = await _make_user(db_session, "ts2@trans.test", "ts2")
    b = await _make_branch(db_session, u, key="TSB")
    t = await _make_task(db_session, b, u, status="done")

    moved = await task_model.transition_status(t, "in_progress", ["todo"], db_session)
    assert moved is None
    assert await _status(db_session, t) == "done"   # 사람이 옮긴 done을 덮지 않음


async def test_transition_status_sequential_second_loses(db_session):
    """선조건 경쟁 시뮬: 1차 호출이 status를 바꾸면, 같은 allowed로 부른 2차 호출은 None."""
    u = await _make_user(db_session, "ts3@trans.test", "ts3")
    b = await _make_branch(db_session, u, key="TSC")
    t = await _make_task(db_session, b, u, status="todo")

    first = await task_model.transition_status(t, "in_progress", ["todo"], db_session)
    assert first == t
    # 이미 in_progress라 allowed=['todo']에 더는 안 맞음 → 두 번째는 패배(None)
    second = await task_model.transition_status(t, "in_progress", ["todo"], db_session)
    assert second is None
    assert await _status(db_session, t) == "in_progress"


async def test_transition_status_empty_allowed_is_noop(db_session):
    """allowed_current_keys가 비면 ANY(빈배열)는 어떤 행도 못 잡아 None."""
    u = await _make_user(db_session, "ts4@trans.test", "ts4")
    b = await _make_branch(db_session, u, key="TSD")
    t = await _make_task(db_session, b, u, status="todo")

    moved = await task_model.transition_status(t, "done", [], db_session)
    assert moved is None
    assert await _status(db_session, t) == "todo"
