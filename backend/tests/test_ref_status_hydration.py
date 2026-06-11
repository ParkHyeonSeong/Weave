"""ref-status 하이드레이션 확장 테스트 — title/display_id/pages/users.

Style: test_idor_ref_status.py와 동일 (model-level 직접 호출, raw INSERT 시드,
rollback-isolated db_session fixture).
"""
from sqlalchemy import text

from core.model import canvas_page as page_model
from core.model import task as task_model
from core.model import task_issue as issue_model
from core.model import user as user_model


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


async def _make_canvas(db, created_by, name="Canvas", key="CVS"):
    # canvas.key는 NOT NULL + UNIQUE (migrations/versions/012_create_wiki_tables.py)
    row = await db.execute(text("""
        INSERT INTO canvas (canvas_name, key, created_by)
        VALUES (:n, :k, :u) RETURNING canvas_id
    """), {"n": name, "k": key, "u": created_by})
    cid = row.scalar_one()
    await db.execute(text("""
        INSERT INTO canvas_member (canvas_id, user_id, role)
        VALUES (:c, :u, 'owner')
    """), {"c": cid, "u": created_by})
    return cid


async def _make_page(db, canvas_id, created_by, title="Page"):
    res = await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, created_by)
        VALUES (:c, :t, :u) RETURNING page_id
    """), {"c": canvas_id, "t": title, "u": created_by})
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


async def test_page_batch_scoped_to_canvas_member(db_session):
    """페이지 배치: 멤버 canvas의 페이지만 title·canvas_name 반환, 비멤버는 제외."""
    alice = await _make_user(db_session, "alice_p@hydr.test", "alice_phy")
    bob = await _make_user(db_session, "bob_p@hydr.test", "bob_phy")

    c1 = await _make_canvas(db_session, alice, name="내 캔버스", key="HYC1")
    p1 = await _make_page(db_session, c1, alice, title="내 페이지")
    c2 = await _make_canvas(db_session, bob, name="남의 캔버스", key="HYC2")
    p2 = await _make_page(db_session, c2, bob, title="비밀 페이지")

    out = await page_model.batch_titles([p1, p2], alice, db_session)
    assert str(p2) not in out
    assert out[str(p1)] == {"title": "내 페이지", "canvas_name": "내 캔버스"}


async def test_user_batch_usernames(db_session):
    """유저 배치: active 유저의 username 반환 (노출 수준은 GET /chat/users와 동일)."""
    alice = await _make_user(db_session, "alice_u@hydr.test", "alice_uhy")
    bob = await _make_user(db_session, "bob_u@hydr.test", "밥이름")

    out = await user_model.batch_usernames([bob], db_session)
    assert out[str(bob)] == {"username": "밥이름"}


async def test_empty_batches_return_empty(db_session):
    alice = await _make_user(db_session, "alice_e2@hydr.test", "alice_e2hy")
    assert await page_model.batch_titles([], alice, db_session) == {}
    assert await user_model.batch_usernames([], db_session) == {}
