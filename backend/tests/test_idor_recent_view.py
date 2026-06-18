"""IDOR regression tests for the recent-view list endpoint (RECENT-VIEW-LEAK).

Same structural leak as STAR-LIST-LEAK: ``recent_view_model.find_recent``
filtered only on ``recent_view.user_id`` and LEFT JOINed live task/canvas_page
metadata without re-checking current branch/canvas membership. A user who
viewed an item while a member, then got removed, kept seeing the live title /
status / canvas name forever.

Fix: type-specific membership joins (task -> branch_member, doc ->
canvas_member) inside the unified query.
"""
from sqlalchemy import text

from core.model import recent_view as recent_view_model


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


async def _view(db, user_id, item_type, item_id):
    await db.execute(text("""
        INSERT INTO recent_view (user_id, item_type, item_id, viewed_at)
        VALUES (:u, :t, :i, NOW())
    """), {"u": user_id, "t": item_type, "i": item_id})


# ---------------------------------------------------------------------------
# task item — removed branch member must NOT see the viewed task metadata
# ---------------------------------------------------------------------------

async def test_recent_task_hidden_after_branch_membership_removed(db_session):
    """branch에서 제거된 사용자는 최근 본 task가 목록에서 빠져야 한다."""
    alice = await _make_user(db_session, "a@recentv.test", "a_rv")
    branch = await _make_branch(db_session, alice, name="B", key="RV1")
    task = await _make_task(db_session, branch, alice, "Secret Strategy")
    await _view(db_session, alice, "task", task)  # 멤버십 없음

    items = await recent_view_model.find_recent(alice, 50, db_session)
    assert all(i.get("task_id") != task for i in items)


# ---------------------------------------------------------------------------
# doc item — removed canvas member must NOT see the viewed page metadata
# ---------------------------------------------------------------------------

async def test_recent_doc_hidden_after_canvas_membership_removed(db_session):
    """canvas에서 제거된 사용자는 최근 본 page가 목록에서 빠져야 한다."""
    carol = await _make_user(db_session, "c@recentv.test", "c_rv")
    branch = await _make_branch(db_session, carol, name="CB", key="RV2")
    canvas = await _make_canvas(db_session, branch, carol, key="rv2")
    page = await _make_canvas_page(db_session, canvas, carol, "Secret Page")
    await _view(db_session, carol, "doc", page)  # canvas 멤버십 없음

    items = await recent_view_model.find_recent(carol, 50, db_session)
    assert all(i.get("page_id") != page for i in items)


# ---------------------------------------------------------------------------
# regression — current members still see their items with correct metadata
# ---------------------------------------------------------------------------

async def test_recent_task_hidden_when_branch_archived(db_session):
    """아카이브된 branch의 최근 본 task는 멤버라도 목록에서 빠진다."""
    alice = await _make_user(db_session, "arch@recentv.test", "arch_rv")
    branch = await _make_branch(db_session, alice, name="AR", key="RVARC")
    await _add_branch_member(db_session, branch, alice, "member")
    task = await _make_task(db_session, branch, alice, "Archived Task")
    await _view(db_session, alice, "task", task)
    await db_session.execute(text("UPDATE branch SET is_archived = TRUE WHERE branch_id = :b"),
                             {"b": branch})

    items = await recent_view_model.find_recent(alice, 50, db_session)
    assert all(i.get("task_id") != task for i in items)


async def test_recent_doc_hidden_when_canvas_archived(db_session):
    """아카이브된 canvas의 최근 본 page는 멤버라도 목록에서 빠진다."""
    carol = await _make_user(db_session, "archd@recentv.test", "archd_rv")
    branch = await _make_branch(db_session, carol, name="ARD", key="RVARD")
    canvas = await _make_canvas(db_session, branch, carol, key="rvard")
    await _add_canvas_member(db_session, canvas, carol, "member")
    page = await _make_canvas_page(db_session, canvas, carol, "Archived Page")
    await _view(db_session, carol, "doc", page)
    await db_session.execute(text("UPDATE canvas SET is_archived = TRUE WHERE canvas_id = :c"),
                             {"c": canvas})

    items = await recent_view_model.find_recent(carol, 50, db_session)
    assert all(i.get("page_id") != page for i in items)


async def test_recent_task_member_returned_with_metadata(db_session):
    """현재 branch 멤버는 최근 본 task를 메타데이터와 함께 정상 반환."""
    alice = await _make_user(db_session, "ok@recentv.test", "ok_rv")
    branch = await _make_branch(db_session, alice, name="OK", key="RVOK")
    await _add_branch_member(db_session, branch, alice, "member")
    task = await _make_task(db_session, branch, alice, "My Task")
    await _view(db_session, alice, "task", task)

    items = await recent_view_model.find_recent(alice, 50, db_session)
    matches = [i for i in items if i.get("task_id") == task]
    assert len(matches) == 1
    m = matches[0]
    assert m["type"] == "task"
    assert m["title"] == "My Task"
    assert m["display_number"] == "RVOK-1"


async def test_recent_doc_member_returned_with_metadata(db_session):
    """현재 canvas 멤버는 최근 본 page를 메타데이터와 함께 정상 반환."""
    carol = await _make_user(db_session, "okc@recentv.test", "okc_rv")
    branch = await _make_branch(db_session, carol, name="OKC", key="RVOKC")
    canvas = await _make_canvas(db_session, branch, carol, key="rvokc")
    await _add_canvas_member(db_session, canvas, carol, "member")
    page = await _make_canvas_page(db_session, canvas, carol, "My Page")
    await _view(db_session, carol, "doc", page)

    items = await recent_view_model.find_recent(carol, 50, db_session)
    matches = [i for i in items if i.get("page_id") == page]
    assert len(matches) == 1
    m = matches[0]
    assert m["type"] == "doc"
    assert m["title"] == "My Page"
    assert m["canvas_name"] == "Canvas"


# ---------------------------------------------------------------------------
# unified-query regression — mixed list keeps the member type, drops the other
# ---------------------------------------------------------------------------

async def test_mixed_list_keeps_member_doc_drops_nonmember_task(db_session):
    """한 목록에 doc(멤버)+task(비멤버)가 섞이면 doc만 남고 task는 빠진다."""
    user = await _make_user(db_session, "mix@recentv.test", "mix_rv")

    # doc: 멤버 (보여야 함)
    branch = await _make_branch(db_session, user, name="MIX", key="RVMIX")
    canvas = await _make_canvas(db_session, branch, user, key="rvmix")
    await _add_canvas_member(db_session, canvas, user, "member")
    page = await _make_canvas_page(db_session, canvas, user, "Visible Page")
    await _view(db_session, user, "doc", page)

    # task: 비멤버 (빠져야 함)
    branch2 = await _make_branch(db_session, user, name="MIX2", key="RVMX2")
    task = await _make_task(db_session, branch2, user, "Hidden Task")
    await _view(db_session, user, "task", task)

    items = await recent_view_model.find_recent(user, 50, db_session)
    page_ids = [i.get("page_id") for i in items if i.get("type") == "doc"]
    task_ids = [i.get("task_id") for i in items if i.get("type") == "task"]
    assert page in page_ids
    assert task not in task_ids
