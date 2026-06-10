"""IDOR regression tests for star toggle/check (SEC-14).

Style: direct controller-level calls (no HTTP client), seeding with raw INSERTs
via the rollback-isolated ``db_session`` fixture. See test_idor_workflow_status.py
/ test_track_home.py for the shared pattern.

Gap: star toggle/check (POST /api/stars, GET /api/stars/check) never verified
that the target item_id belonged to a branch/canvas the caller is a member of —
any user could star/unstar (and enumerate existence/membership of) arbitrary
tasks (item_type='task' -> branch) or canvas pages (item_type='doc' -> canvas).
The safe pattern: fetch the resource via the branch_scope guard, then check
branch_member / canvas_member membership before calling star_model.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import star as ctrl
from routers.star import StarToggle


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


async def _add_branch_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by, title="task"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "u": created_by})
    return res.scalar_one()


async def _make_canvas(db, branch_id, created_by, key="cv"):
    row = await db.execute(text("""
        INSERT INTO canvas (branch_id, canvas_name, key, visibility, created_by)
        VALUES (:b, 'Canvas', :k, 'private', :u) RETURNING canvas_id
    """), {"b": branch_id, "k": key, "u": created_by})
    return row.scalar_one()


async def _add_canvas_member(db, canvas_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO canvas_member (canvas_id, user_id, role)
        VALUES (:c, :u, :r)
    """), {"c": canvas_id, "u": user_id, "r": role})


async def _make_canvas_page(db, canvas_id, created_by, title="page"):
    res = await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, position,
                                 created_by, updated_by, type)
        VALUES (:c, :t, '', 0, :u, :u, 'document') RETURNING page_id
    """), {"c": canvas_id, "t": title, "u": created_by})
    return res.scalar_one()


async def _is_starred_row(db, user_id, item_type, item_id):
    res = await db.execute(text("""
        SELECT 1 FROM user_star
        WHERE user_id = :u AND item_type = :t AND item_id = :i
    """), {"u": user_id, "t": item_type, "i": item_id})
    return res.fetchone() is not None


# ---------------------------------------------------------------------------
# toggle — task IDOR (cross-branch)
# ---------------------------------------------------------------------------

async def test_toggle_task_rejects_non_member_branch(db_session):
    """branch1 멤버 alice가 branch2의 task를 star 시도 → NOT_BRANCH_MEMBER, 미반영."""
    alice = await _make_user(db_session, "alice@idorstar.test", "alice_s")
    bob = await _make_user(db_session, "bob@idorstar.test", "bob_s")

    branch1 = await _make_branch(db_session, alice, name="B1", key="STB1")
    await _add_branch_member(db_session, branch1, alice, "member")

    branch2 = await _make_branch(db_session, bob, name="B2", key="STB2")
    await _add_branch_member(db_session, branch2, bob, "member")
    victim_task = await _make_task(db_session, branch2, bob, "Secret Task")

    res = await ctrl.toggle(
        StarToggle(item_type="task", item_id=victim_task), _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "NOT_BRANCH_MEMBER"

    # 거부됐으므로 star 행이 생기지 않아야 한다
    assert await _is_starred_row(db_session, alice, "task", victim_task) is False


# ---------------------------------------------------------------------------
# toggle — doc/canvas IDOR (cross-canvas)
# ---------------------------------------------------------------------------

async def test_toggle_doc_rejects_non_member_canvas(db_session):
    """canvas1 멤버 carol이 canvas2의 page를 star 시도 → NOT_CANVAS_MEMBER, 미반영."""
    carol = await _make_user(db_session, "carol@idorstar.test", "carol_s")
    dave = await _make_user(db_session, "dave@idorstar.test", "dave_s")

    branch1 = await _make_branch(db_session, carol, name="CB1", key="STC1")
    canvas1 = await _make_canvas(db_session, branch1, carol, key="stc1")
    await _add_canvas_member(db_session, canvas1, carol, "member")

    branch2 = await _make_branch(db_session, dave, name="CB2", key="STC2")
    canvas2 = await _make_canvas(db_session, branch2, dave, key="stc2")
    await _add_canvas_member(db_session, canvas2, dave, "member")
    victim_page = await _make_canvas_page(db_session, canvas2, dave, "Secret Page")

    res = await ctrl.toggle(
        StarToggle(item_type="doc", item_id=victim_page), _req(carol), db_session)
    assert res["status"] is False
    assert res["message"] == "NOT_CANVAS_MEMBER"

    assert await _is_starred_row(db_session, carol, "doc", victim_page) is False


# ---------------------------------------------------------------------------
# toggle — not-found resources (no enumeration leak distinction needed,
# both fall under existence checks before membership)
# ---------------------------------------------------------------------------

async def test_toggle_task_rejects_missing_resource(db_session):
    """존재하지 않는 task id → TASK_NOT_FOUND."""
    alice = await _make_user(db_session, "ghost@idorstar.test", "ghost_s")
    res = await ctrl.toggle(
        StarToggle(item_type="task", item_id=999999), _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "TASK_NOT_FOUND"


# ---------------------------------------------------------------------------
# regression — member happy paths still toggle on/off
# ---------------------------------------------------------------------------

async def test_toggle_task_member_succeeds_and_toggles(db_session):
    """멤버는 자기 branch task를 정상 star/unstar."""
    alice = await _make_user(db_session, "okmember@idorstar.test", "okmember_s")
    branch1 = await _make_branch(db_session, alice, name="OKB", key="STOK1")
    await _add_branch_member(db_session, branch1, alice, "member")
    task = await _make_task(db_session, branch1, alice, "Mine")

    res = await ctrl.toggle(
        StarToggle(item_type="task", item_id=task), _req(alice), db_session)
    assert res["status"] is True
    assert res["starred"] is True
    assert await _is_starred_row(db_session, alice, "task", task) is True

    # 다시 토글하면 해제
    res = await ctrl.toggle(
        StarToggle(item_type="task", item_id=task), _req(alice), db_session)
    assert res["status"] is True
    assert res["starred"] is False
    assert await _is_starred_row(db_session, alice, "task", task) is False


async def test_toggle_doc_member_succeeds(db_session):
    """canvas 멤버는 자기 canvas page를 정상 star."""
    carol = await _make_user(db_session, "okcanvas@idorstar.test", "okcanvas_s")
    branch1 = await _make_branch(db_session, carol, name="OKCB", key="STOKC")
    canvas1 = await _make_canvas(db_session, branch1, carol, key="stokc")
    await _add_canvas_member(db_session, canvas1, carol, "member")
    page = await _make_canvas_page(db_session, canvas1, carol, "MyPage")

    res = await ctrl.toggle(
        StarToggle(item_type="doc", item_id=page), _req(carol), db_session)
    assert res["status"] is True
    assert res["starred"] is True
    assert await _is_starred_row(db_session, carol, "doc", page) is True


# ---------------------------------------------------------------------------
# check (is_starred) — same authorization gate
# ---------------------------------------------------------------------------

async def test_check_task_rejects_non_member_branch(db_session):
    """비멤버는 다른 branch task의 star 상태 조회도 거부 (존재 enumeration 차단)."""
    alice = await _make_user(db_session, "chka@idorstar.test", "chka_s")
    bob = await _make_user(db_session, "chkb@idorstar.test", "chkb_s")

    branch1 = await _make_branch(db_session, alice, name="CKB1", key="STCK1")
    await _add_branch_member(db_session, branch1, alice, "member")

    branch2 = await _make_branch(db_session, bob, name="CKB2", key="STCK2")
    await _add_branch_member(db_session, branch2, bob, "member")
    victim_task = await _make_task(db_session, branch2, bob, "Secret")

    res = await ctrl.is_starred("task", victim_task, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "NOT_BRANCH_MEMBER"
