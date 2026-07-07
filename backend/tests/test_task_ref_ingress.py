"""Status/Type ref ingress tests — 해석 헬퍼, create 기본값, update alias.

Style: direct controller-function calls (no HTTP client), request via
SimpleNamespace, seed rows with raw sqlalchemy text() INSERTs
(test_controller_task_errors.py 컨벤션). status/type 시드는 기본값·alias
시나리오별 제어가 필요해 branch 시드와 분리돼 있다.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task as ctrl
from core.model import task_type_config as type_model
from core.model import workflow_status as ws_model
from routers.schema import task as schema


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(
        payload={'user_id': user_id, 'username': 'tester'}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Branch", key="TRI"):
    """Bare branch — status/type 시드는 각 테스트가 _add_status/_add_type으로."""
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    return row.scalar_one()


async def _add_status(db, branch_id, key, label, category="todo",
                      sort=0, is_default=False):
    row = await db.execute(text("""
        INSERT INTO workflow_status (branch_id, key, label, color, category,
                                     sort_order, is_default)
        VALUES (:b, :k, :l, '#9CA3AF', :c, :s, :d) RETURNING workflow_status_id
    """), {"b": branch_id, "k": key, "l": label, "c": category,
           "s": sort, "d": is_default})
    return row.scalar_one()


async def _add_type(db, branch_id, type_key, type_name, sort=0):
    row = await db.execute(text("""
        INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
        VALUES (:b, :k, :n, 'check', '#5E6AD2', :s) RETURNING type_id
    """), {"b": branch_id, "k": type_key, "n": type_name, "s": sort})
    return row.scalar_one()


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task_sequence(db, branch_id):
    await db.execute(text("""
        INSERT INTO task_sequence (branch_id, last_number)
        VALUES (:b, COALESCE((SELECT MAX(display_number) FROM task WHERE branch_id = :b), 0))
        ON CONFLICT (branch_id) DO UPDATE SET last_number = EXCLUDED.last_number
    """), {"b": branch_id})


async def _seed_standard(db, *, key="TRI"):
    """기본 시나리오: 시드 branch와 동일 (todo=is_default, 4 status / task=0번 type)."""
    uid = await _make_user(db, f"u_{key}@tri.test", f"u_{key}")
    bid = await _make_branch(db, uid, key=key)
    await _add_status(db, bid, "todo", "To Do", "todo", 0, True)
    await _add_status(db, bid, "in_progress", "In Progress", "in_progress", 1)
    await _add_status(db, bid, "done", "Done", "done", 2)
    await _add_status(db, bid, "cancelled", "Cancelled", "cancelled", 3)
    await _add_type(db, bid, "task", "Task", 0)
    await _add_type(db, bid, "bug", "Bug", 1)
    await _add_member(db, bid, uid, "admin")
    await _make_task_sequence(db, bid)
    return uid, bid


# ---------------------------------------------------------------------------
# Task 1: model helpers
# ---------------------------------------------------------------------------

async def test_find_default_prefers_is_default(db_session):
    uid = await _make_user(db_session, "fd1@tri.test", "fd1")
    bid = await _make_branch(db_session, uid, key="FD1")
    await _add_status(db_session, bid, "backlog", "Backlog", "todo", 0)
    await _add_status(db_session, bid, "doing", "Doing", "in_progress", 1, is_default=True)
    row = await ws_model.find_default(bid, db_session)
    assert row["key"] == "doing"


async def test_find_default_falls_back_to_first_sort_order(db_session):
    uid = await _make_user(db_session, "fd2@tri.test", "fd2")
    bid = await _make_branch(db_session, uid, key="FD2")
    await _add_status(db_session, bid, "later", "Later", "todo", 5)
    await _add_status(db_session, bid, "first", "First", "todo", 1)
    row = await ws_model.find_default(bid, db_session)
    assert row["key"] == "first"


async def test_find_default_empty_branch_returns_none(db_session):
    uid = await _make_user(db_session, "fd3@tri.test", "fd3")
    bid = await _make_branch(db_session, uid, key="FD3")
    assert await ws_model.find_default(bid, db_session) is None


async def test_find_first_type_by_sort_order(db_session):
    uid = await _make_user(db_session, "ff1@tri.test", "ff1")
    bid = await _make_branch(db_session, uid, key="FF1")
    await _add_type(db_session, bid, "story", "Story", 3)
    await _add_type(db_session, bid, "task", "Task", 0)
    row = await type_model.find_first(bid, db_session)
    assert row["type_key"] == "task"
    assert "type_id" in row  # create의 custom_fields 검증이 type_id를 씀


async def test_find_first_type_empty_branch_returns_none(db_session):
    uid = await _make_user(db_session, "ff2@tri.test", "ff2")
    bid = await _make_branch(db_session, uid, key="FF2")
    assert await type_model.find_first(bid, db_session) is None
