from datetime import date
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task as ctrl
from routers.schema import task as schema


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


async def _make_status(db, branch_id, key="todo", category="todo"):
    await db.execute(text("""
        INSERT INTO workflow_status (branch_id, key, label, category, color, sort_order)
        VALUES (:b, :k, :k, :c, '#888888', 0)
    """), {"b": branch_id, "k": key, "c": category})


async def _make_task_type(db, branch_id, key="task"):
    await db.execute(text("""
        INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
        VALUES (:b, :k, :k, 'check', '#888888', 0)
    """), {"b": branch_id, "k": key})


async def _make_task(db, branch_id, created_by, start=None, due=None):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by, start_date, due_date)
        VALUES (:b, :dn, 'T', 'todo', :u, :s, :d) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "u": created_by, "s": start, "d": due})
    return res.scalar_one()


async def _make_task_sequence(db, branch_id):
    await db.execute(text("""
        INSERT INTO task_sequence (branch_id, last_number)
        VALUES (:b, COALESCE((SELECT MAX(display_number) FROM task WHERE branch_id = :b), 0))
        ON CONFLICT (branch_id) DO UPDATE SET last_number = EXCLUDED.last_number
    """), {"b": branch_id})


async def _col(db, task_id, c):
    res = await db.execute(text(f"SELECT {c} FROM task WHERE task_id = :t"), {"t": task_id})
    return res.scalar_one()


async def test_create_rejects_start_after_due(db_session):
    alice = await _make_user(db_session, "a_tcreate@d.test", "a_tcreate")
    branch = await _make_branch(db_session, alice, "TDV1")
    await _add_member(db_session, branch, alice)
    await _make_status(db_session, branch)
    await _make_task_type(db_session, branch)
    await _make_task_sequence(db_session, branch)
    body = schema.TaskCreate(title='T', start_date=date(2026, 6, 25), due_date=date(2026, 6, 18))
    res = await ctrl.create(body, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "INVALID_DATE_RANGE"
    count = (await db_session.execute(
        text("SELECT COUNT(*) FROM task WHERE branch_id = :b"), {"b": branch}
    )).scalar_one()
    assert count == 0


async def test_create_valid(db_session):
    alice = await _make_user(db_session, "a_tcok@d.test", "a_tcok")
    branch = await _make_branch(db_session, alice, "TDV2")
    await _add_member(db_session, branch, alice)
    await _make_status(db_session, branch)
    await _make_task_type(db_session, branch)
    await _make_task_sequence(db_session, branch)
    body = schema.TaskCreate(title='T', start_date=date(2026, 6, 18), due_date=date(2026, 6, 25))
    res = await ctrl.create(body, branch, _req(alice), db_session)
    assert res["status"] is True


async def test_update_partial_start_after_stored_due_rejected(db_session):
    alice = await _make_user(db_session, "a_tupd@d.test", "a_tupd")
    branch = await _make_branch(db_session, alice, "TDV3")
    await _add_member(db_session, branch, alice)
    await _make_status(db_session, branch)
    task = await _make_task(db_session, branch, alice, start=None, due=date(2026, 6, 20))
    body = schema.TaskUpdate(start_date=date(2026, 6, 25))
    res = await ctrl.update(task, body, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "INVALID_DATE_RANGE"
    assert await _col(db_session, task, "start_date") is None


async def test_update_partial_due_before_stored_start_rejected(db_session):
    """저장된 start_date(6/20)만 있고 due_date만 6/10으로 PATCH → 병합 검증(역방향)으로 거부."""
    alice = await _make_user(db_session, "a_tupd2@d.test", "a_tupd2")
    branch = await _make_branch(db_session, alice, "TDV4")
    await _add_member(db_session, branch, alice)
    await _make_status(db_session, branch)
    task = await _make_task(db_session, branch, alice, start=date(2026, 6, 20), due=None)
    body = schema.TaskUpdate(due_date=date(2026, 6, 10))
    res = await ctrl.update(task, body, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "INVALID_DATE_RANGE"
    assert await _col(db_session, task, "due_date") is None
