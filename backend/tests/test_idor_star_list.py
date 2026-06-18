"""IDOR regression tests for the star *list* endpoint (STAR-LIST-LEAK).

Style: direct model-level calls (no HTTP client), seeding with raw INSERTs via
the rollback-isolated ``db_session`` fixture. See test_idor_star.py /
test_track_home.py for the shared pattern.

Gap: ``star_model.find_starred`` returned starred items (and their *current*
metadata: title, status, branch key, canvas name) by filtering only on
``user_star.user_id`` — it never re-checked whether the caller is still a
member of the task's branch / page's canvas. A user who starred an item while
briefly a member, then got removed, kept seeing the live metadata forever.

The fix adds type-specific membership joins:
  task items -> branch_member, doc items -> canvas_member.
Because find_starred unifies task+doc rows in one query, a naive single INNER
JOIN would drop the *other* type entirely; the join must be type-scoped.
"""
from sqlalchemy import text

from core.model import star as star_model


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


async def _star(db, user_id, item_type, item_id):
    await db.execute(text("""
        INSERT INTO user_star (user_id, item_type, item_id)
        VALUES (:u, :t, :i)
    """), {"u": user_id, "t": item_type, "i": item_id})


# ---------------------------------------------------------------------------
# task item — removed branch member must NOT see the starred task metadata
# ---------------------------------------------------------------------------

async def test_starred_task_hidden_after_branch_membership_removed(db_session):
    """branch에서 제거된 사용자는 별표한 task가 목록에서 빠져야 한다."""
    alice = await _make_user(db_session, "a@starlist.test", "a_sl")
    branch = await _make_branch(db_session, alice, name="B", key="SL1")
    task = await _make_task(db_session, branch, alice, "Secret Strategy")
    # alice는 별표 후 멤버십 상실 (branch_member 행 없음)
    await _star(db_session, alice, "task", task)

    items = await star_model.find_starred(alice, 50, db_session)
    assert all(i.get("task_id") != task for i in items)


# ---------------------------------------------------------------------------
# doc item — removed canvas member must NOT see the starred page metadata
# ---------------------------------------------------------------------------

async def test_starred_doc_hidden_after_canvas_membership_removed(db_session):
    """canvas에서 제거된 사용자는 별표한 page가 목록에서 빠져야 한다."""
    carol = await _make_user(db_session, "c@starlist.test", "c_sl")
    branch = await _make_branch(db_session, carol, name="CB", key="SL2")
    canvas = await _make_canvas(db_session, branch, carol, key="sl2")
    page = await _make_canvas_page(db_session, canvas, carol, "Secret Page")
    # carol은 별표 후 canvas 멤버십 상실
    await _star(db_session, carol, "doc", page)

    items = await star_model.find_starred(carol, 50, db_session)
    assert all(i.get("page_id") != page for i in items)


# ---------------------------------------------------------------------------
# regression — current members still see their items with correct metadata
# ---------------------------------------------------------------------------

async def test_starred_task_hidden_when_branch_archived(db_session):
    """아카이브된 branch의 별표 task는 멤버라도 목록에서 빠진다."""
    alice = await _make_user(db_session, "arch@starlist.test", "arch_sl")
    branch = await _make_branch(db_session, alice, name="AR", key="SLARC")
    await _add_branch_member(db_session, branch, alice, "member")
    task = await _make_task(db_session, branch, alice, "Archived Task")
    await _star(db_session, alice, "task", task)
    await db_session.execute(text("UPDATE branch SET is_archived = TRUE WHERE branch_id = :b"),
                             {"b": branch})

    items = await star_model.find_starred(alice, 50, db_session)
    assert all(i.get("task_id") != task for i in items)


async def test_starred_doc_hidden_when_canvas_archived(db_session):
    """아카이브된 canvas의 별표 page는 멤버라도 목록에서 빠진다."""
    carol = await _make_user(db_session, "archd@starlist.test", "archd_sl")
    branch = await _make_branch(db_session, carol, name="ARD", key="SLARD")
    canvas = await _make_canvas(db_session, branch, carol, key="slard")
    await _add_canvas_member(db_session, canvas, carol, "member")
    page = await _make_canvas_page(db_session, canvas, carol, "Archived Page")
    await _star(db_session, carol, "doc", page)
    await db_session.execute(text("UPDATE canvas SET is_archived = TRUE WHERE canvas_id = :c"),
                             {"c": canvas})

    items = await star_model.find_starred(carol, 50, db_session)
    assert all(i.get("page_id") != page for i in items)


async def test_starred_task_member_returned_with_metadata(db_session):
    """현재 branch 멤버는 별표 task를 메타데이터와 함께 정상 반환."""
    alice = await _make_user(db_session, "ok@starlist.test", "ok_sl")
    branch = await _make_branch(db_session, alice, name="OK", key="SLOK")
    await _add_branch_member(db_session, branch, alice, "member")
    task = await _make_task(db_session, branch, alice, "My Task")
    await _star(db_session, alice, "task", task)

    items = await star_model.find_starred(alice, 50, db_session)
    matches = [i for i in items if i.get("task_id") == task]
    assert len(matches) == 1
    m = matches[0]
    assert m["type"] == "task"
    assert m["title"] == "My Task"
    assert m["display_number"] == "SLOK-1"
    assert m["status"] == "todo"


async def test_starred_doc_member_returned_with_metadata(db_session):
    """현재 canvas 멤버는 별표 page를 메타데이터와 함께 정상 반환."""
    carol = await _make_user(db_session, "okc@starlist.test", "okc_sl")
    branch = await _make_branch(db_session, carol, name="OKC", key="SLOKC")
    canvas = await _make_canvas(db_session, branch, carol, key="slokc")
    await _add_canvas_member(db_session, canvas, carol, "member")
    page = await _make_canvas_page(db_session, canvas, carol, "My Page")
    await _star(db_session, carol, "doc", page)

    items = await star_model.find_starred(carol, 50, db_session)
    matches = [i for i in items if i.get("page_id") == page]
    assert len(matches) == 1
    m = matches[0]
    assert m["type"] == "doc"
    assert m["title"] == "My Page"
    assert m["canvas_name"] == "Canvas"


# ---------------------------------------------------------------------------
# unified-query regression — mixed list keeps the member type, drops the other
# ---------------------------------------------------------------------------

async def test_mixed_list_keeps_member_task_drops_nonmember_doc(db_session):
    """한 목록에 task(멤버)+doc(비멤버)가 섞이면 task만 남고 doc은 빠진다.

    타입별 필터가 정확해야 한다: 단일 INNER JOIN으로는 task 행이 doc 멤버십
    부재로 통째로 사라지는 회귀가 발생한다.
    """
    user = await _make_user(db_session, "mix@starlist.test", "mix_sl")

    # task: 멤버 (보여야 함)
    branch = await _make_branch(db_session, user, name="MIX", key="SLMIX")
    await _add_branch_member(db_session, branch, user, "member")
    task = await _make_task(db_session, branch, user, "Visible Task")
    await _star(db_session, user, "task", task)

    # doc: 비멤버 (빠져야 함)
    branch2 = await _make_branch(db_session, user, name="MIX2", key="SLMX2")
    canvas = await _make_canvas(db_session, branch2, user, key="slmix")
    page = await _make_canvas_page(db_session, canvas, user, "Hidden Page")
    await _star(db_session, user, "doc", page)

    items = await star_model.find_starred(user, 50, db_session)
    task_ids = [i.get("task_id") for i in items if i.get("type") == "task"]
    page_ids = [i.get("page_id") for i in items if i.get("type") == "doc"]
    assert task in task_ids
    assert page not in page_ids


# ---------------------------------------------------------------------------
# item_type filter still works alongside the membership scoping
# ---------------------------------------------------------------------------

async def test_item_type_filter_preserved(db_session):
    """item_type='task' 필터는 멤버십 스코핑과 함께 동작한다."""
    user = await _make_user(db_session, "flt@starlist.test", "flt_sl")
    branch = await _make_branch(db_session, user, name="FLT", key="SLFLT")
    await _add_branch_member(db_session, branch, user, "member")
    task = await _make_task(db_session, branch, user, "T")
    await _star(db_session, user, "task", task)

    canvas = await _make_canvas(db_session, branch, user, key="slflt")
    await _add_canvas_member(db_session, canvas, user, "member")
    page = await _make_canvas_page(db_session, canvas, user, "P")
    await _star(db_session, user, "doc", page)

    items = await star_model.find_starred(user, 50, db_session, item_type="task")
    assert all(i["type"] == "task" for i in items)
    assert any(i.get("task_id") == task for i in items)
