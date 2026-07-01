"""E2E: GitHub webhook dispatch -> ref upsert + task transition + activity log.

Model/controller-level (no HTTP client where avoidable). Seeds with raw INSERTs
on the rollback-isolated db_session fixture (see test_idor_ref_status.py).
"""
import hashlib
import hmac
import json

from sqlalchemy import text

from core.model import branch as branch_model


# --- seed helpers (raw INSERT — real schema column names) -----------------
async def _make_user(db, email, username, is_system=False):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, is_system)
        VALUES (:e, :p, :u, 'active', :sys) RETURNING user_id
    """), {"e": email, "p": b"x", "u": username, "sys": is_system})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Branch", key="GHKEY"):
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


async def _make_task(db, branch_id, created_by, title="Task", status="in_progress"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, :s, :u) RETURNING task_id, display_number
    """), {"b": branch_id, "dn": dn, "t": title, "s": status, "u": created_by})
    r = res.fetchone()
    return r[0], r[1]


async def _make_integration(db, branch_id, repo, installation_id, created_by):
    await db.execute(text("""
        INSERT INTO github_integration (branch_id, repo_full_name, installation_id, created_by)
        VALUES (:b, :r, :i, :u)
    """), {"b": branch_id, "r": repo, "i": installation_id, "u": created_by})


async def _system_bot(db):
    row = await db.execute(text(
        "SELECT user_id FROM \"user\" WHERE is_system = TRUE ORDER BY user_id LIMIT 1"))
    r = row.fetchone()
    return r[0] if r else None


# --- find_by_key_row -------------------------------------------------------
async def test_find_by_key_row_case_insensitive(db_session):
    alice = await _make_user(db_session, "a_fk@gh.test", "a_fk")
    bid = await _make_branch(db_session, alice, key="WVX")
    row = await branch_model.find_by_key_row("wvx", db_session)
    assert row is not None
    assert row["branch_id"] == bid
    assert row["key"] == "WVX"


async def test_find_by_key_row_missing_returns_none(db_session):
    assert await branch_model.find_by_key_row("NOPE", db_session) is None
