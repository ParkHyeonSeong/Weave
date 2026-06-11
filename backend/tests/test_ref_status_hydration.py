"""ref-status 하이드레이션 확장 테스트 — title/display_id/pages/users.

Style: test_idor_ref_status.py와 동일 (model-level 직접 호출, raw INSERT 시드,
rollback-isolated db_session fixture).
"""
from sqlalchemy import text

from core.model import task as task_model
from core.model import task_issue as issue_model


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
    await db.execute(text("""
        INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order)
        VALUES (:b, 'todo', 'To Do', '#9CA3AF', 'todo', 0)
    """), {"b": bid})
    return bid


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by, title="Task", status="todo"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, :s, :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "s": status, "u": created_by})
    return res.scalar_one()


async def _make_issue(db, task_id, created_by, title="Issue", status="open"):
    res = await db.execute(text("""
        INSERT INTO task_issue (task_id, title, body, status, created_by)
        VALUES (:t, :title, 'body', :s, :u) RETURNING issue_id
    """), {"t": task_id, "title": title, "s": status, "u": created_by})
    return res.scalar_one()


async def test_task_batch_includes_title_and_display_id(db_session):
    """칩 하이드레이션용: 멤버 branch task는 title·display_id까지 반환한다."""
    alice = await _make_user(db_session, "alice@hydr.test", "alice_hy")
    b1 = await _make_branch(db_session, alice, name="B1", key="HYD")
    await _add_member(db_session, b1, alice, "member")
    t1 = await _make_task(db_session, b1, alice, title="새 제목", status="todo")

    out = await task_model.batch_statuses([t1], alice, db_session)
    assert out[str(t1)]["title"] == "새 제목"
    assert out[str(t1)]["display_id"] == "HYD-1"


async def test_issue_batch_includes_title(db_session):
    """멤버 branch task의 issue는 title까지 반환한다."""
    alice = await _make_user(db_session, "alice_i@hydr.test", "alice_ihy")
    b1 = await _make_branch(db_session, alice, name="B1", key="HYDI")
    await _add_member(db_session, b1, alice, "member")
    t1 = await _make_task(db_session, b1, alice)
    i1 = await _make_issue(db_session, t1, alice, title="이슈 제목", status="open")

    out = await issue_model.batch_statuses([i1], alice, db_session)
    assert out[str(i1)]["title"] == "이슈 제목"
    assert out[str(i1)]["status"] == "open"
