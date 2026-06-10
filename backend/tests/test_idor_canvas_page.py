"""IDOR regression tests for canvas_page create/move/copy parent_page_id (LOG-02).

Style: direct controller-level calls (no HTTP client), seeding with raw INSERTs
via the rollback-isolated ``db_session`` fixture. See test_idor_workflow_status.py /
test_track_home.py for the shared pattern.

Gap: ``create``/``move``/``copy`` checked only canvas membership and that the
target page belonged to the canvas, but never verified that ``body.parent_page_id``
belonged to the SAME canvas. A canvas-A member could pass a canvas-B page_id as
parent — corrupting the page tree / creating a cross-canvas reference.

Scope note: this is a CANVAS-scoped check (parent must share ``canvas_id``),
not a branch-scoped one.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import canvas_page as ctrl
from routers.schema import canvas_page as schema


def _req(user_id: int):
    """controller가 읽는 request.state.payload만 흉내낸다."""
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id, 'username': 'tester'}))


# ---------------------------------------------------------------------------
# seed helpers (raw INSERT — real schema column names)
# ---------------------------------------------------------------------------

async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_canvas(db, created_by, name="Canvas", key="KEY"):
    row = await db.execute(text("""
        INSERT INTO canvas (canvas_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#16A34A', :u) RETURNING canvas_id
    """), {"n": name, "k": key, "u": created_by})
    return row.scalar_one()


async def _add_member(db, canvas_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO canvas_member (canvas_id, user_id, role)
        VALUES (:c, :u, :r)
    """), {"c": canvas_id, "u": user_id, "r": role})


async def _make_page(db, canvas_id, created_by, title="Page", parent_page_id=None,
                     page_type="document"):
    row = await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, position, created_by,
                                 updated_by, parent_page_id, type)
        VALUES (:c, :t, '<p></p>', 0, :cb, :cb, :p, :ty) RETURNING page_id
    """), {"c": canvas_id, "t": title, "cb": created_by, "p": parent_page_id, "ty": page_type})
    return row.scalar_one()


async def _page_row(db, page_id):
    res = await db.execute(text("""
        SELECT page_id, canvas_id, parent_page_id, title
        FROM canvas_page WHERE page_id = :p
    """), {"p": page_id})
    row = res.fetchone()
    return dict(row._mapping) if row else None


# ---------------------------------------------------------------------------
# create — cross-canvas parent IDOR
# ---------------------------------------------------------------------------

async def test_create_rejects_parent_from_other_canvas(db_session):
    """canvas_a 멤버가 canvas_b 페이지를 parent로 지정 → PARENT_PAGE_NOT_FOUND."""
    alice = await _make_user(db_session, "alice_cp@idor.test", "alice_cp")
    bob = await _make_user(db_session, "bob_cp@idor.test", "bob_cp")

    canvas_a = await _make_canvas(db_session, alice, name="CA", key="ICPA")
    await _add_member(db_session, canvas_a, alice, "member")

    canvas_b = await _make_canvas(db_session, bob, name="CB", key="ICPB")
    await _add_member(db_session, canvas_b, bob, "admin")
    page_b = await _make_page(db_session, canvas_b, bob, title="Protected B")

    res = await ctrl.create(
        canvas_a,
        schema.CanvasPageCreate(title="Hacked", content="", parent_page_id=page_b, type="document"),
        _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "PARENT_PAGE_NOT_FOUND"

    # canvas_a 아래에 cross-canvas parent를 가진 페이지가 만들어지지 않아야 함
    leaked = await db_session.execute(text("""
        SELECT COUNT(*) FROM canvas_page
        WHERE canvas_id = :c AND parent_page_id = :p
    """), {"c": canvas_a, "p": page_b})
    assert leaked.scalar_one() == 0


# ---------------------------------------------------------------------------
# move — cross-canvas parent IDOR
# ---------------------------------------------------------------------------

async def test_move_rejects_parent_from_other_canvas(db_session):
    """canvas_a 페이지를 canvas_b 페이지 아래로 이동 → PARENT_PAGE_NOT_FOUND."""
    alice = await _make_user(db_session, "alice_mv@idor.test", "alice_mv")
    bob = await _make_user(db_session, "bob_mv@idor.test", "bob_mv")

    canvas_a = await _make_canvas(db_session, alice, name="CMA", key="IMVA")
    await _add_member(db_session, canvas_a, alice, "member")
    page_a = await _make_page(db_session, canvas_a, alice, title="A to move")

    canvas_b = await _make_canvas(db_session, bob, name="CMB", key="IMVB")
    await _add_member(db_session, canvas_b, bob, "admin")
    page_b_parent = await _make_page(db_session, canvas_b, bob, title="Parent in B",
                                     page_type="folder")

    res = await ctrl.move(
        canvas_a, page_a,
        schema.CanvasPageMove(parent_page_id=page_b_parent, position=0),
        _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "PARENT_PAGE_NOT_FOUND"

    # page_a의 parent는 변경되지 않아야 함 (여전히 root)
    after = await _page_row(db_session, page_a)
    assert after["parent_page_id"] is None


# ---------------------------------------------------------------------------
# copy — cross-canvas parent IDOR
# ---------------------------------------------------------------------------

async def test_copy_rejects_parent_from_other_canvas(db_session):
    """canvas_a 페이지를 canvas_b 페이지 아래에 복제 → PARENT_PAGE_NOT_FOUND."""
    alice = await _make_user(db_session, "alice_cy@idor.test", "alice_cy")
    bob = await _make_user(db_session, "bob_cy@idor.test", "bob_cy")

    canvas_a = await _make_canvas(db_session, alice, name="CCA", key="ICYA")
    await _add_member(db_session, canvas_a, alice, "member")
    page_a = await _make_page(db_session, canvas_a, alice, title="A to copy")

    canvas_b = await _make_canvas(db_session, bob, name="CCB", key="ICYB")
    await _add_member(db_session, canvas_b, bob, "admin")
    page_b_parent = await _make_page(db_session, canvas_b, bob, title="Parent in B",
                                     page_type="folder")

    res = await ctrl.copy(
        canvas_a, page_a,
        schema.CanvasPageCopy(parent_page_id=page_b_parent),
        _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "PARENT_PAGE_NOT_FOUND"

    # canvas_b 아래에 복제본이 생기지 않아야 함
    leaked = await db_session.execute(text("""
        SELECT COUNT(*) FROM canvas_page WHERE parent_page_id = :p
    """), {"p": page_b_parent})
    assert leaked.scalar_one() == 0


# ---------------------------------------------------------------------------
# regression — same-canvas parent + root (None) still work
# ---------------------------------------------------------------------------

async def test_create_root_and_same_canvas_parent_succeed(db_session):
    alice = await _make_user(db_session, "alice_ok@idor.test", "alice_ok")
    canvas_a = await _make_canvas(db_session, alice, name="OKC", key="IOKC")
    await _add_member(db_session, canvas_a, alice, "member")

    # 루트 레벨 (parent_page_id=None) 생성 정상
    res_root = await ctrl.create(
        canvas_a,
        schema.CanvasPageCreate(title="Root", content="", type="document"),
        _req(alice), db_session,
    )
    assert res_root["status"] is True
    root_id = res_root["page_id"]

    # 같은 canvas의 페이지를 parent로 지정한 생성 정상
    res_child = await ctrl.create(
        canvas_a,
        schema.CanvasPageCreate(title="Child", content="", parent_page_id=root_id, type="document"),
        _req(alice), db_session,
    )
    assert res_child["status"] is True
    child = await _page_row(db_session, res_child["page_id"])
    assert child["parent_page_id"] == root_id
    assert child["canvas_id"] == canvas_a


async def test_move_same_canvas_parent_and_root_succeed(db_session):
    alice = await _make_user(db_session, "alice_okm@idor.test", "alice_okm")
    canvas_a = await _make_canvas(db_session, alice, name="OKM", key="IOKM")
    await _add_member(db_session, canvas_a, alice, "member")

    folder = await _make_page(db_session, canvas_a, alice, title="Folder", page_type="folder")
    page = await _make_page(db_session, canvas_a, alice, title="Doc")

    # 같은 canvas의 folder 아래로 이동 정상
    res = await ctrl.move(
        canvas_a, page,
        schema.CanvasPageMove(parent_page_id=folder, position=0),
        _req(alice), db_session,
    )
    assert res["status"] is True
    after = await _page_row(db_session, page)
    assert after["parent_page_id"] == folder

    # 루트로 다시 이동 (parent None) 정상
    res_root = await ctrl.move(
        canvas_a, page,
        schema.CanvasPageMove(parent_page_id=None, position=0),
        _req(alice), db_session,
    )
    assert res_root["status"] is True
    after_root = await _page_row(db_session, page)
    assert after_root["parent_page_id"] is None


async def test_copy_root_succeeds(db_session):
    alice = await _make_user(db_session, "alice_okc@idor.test", "alice_okc")
    canvas_a = await _make_canvas(db_session, alice, name="OKCY", key="IOKCY")
    await _add_member(db_session, canvas_a, alice, "member")
    page = await _make_page(db_session, canvas_a, alice, title="Doc to copy")

    res = await ctrl.copy(
        canvas_a, page,
        schema.CanvasPageCopy(parent_page_id=None),
        _req(alice), db_session,
    )
    assert res["status"] is True
    new_page = await _page_row(db_session, res["page_id"])
    assert new_page["canvas_id"] == canvas_a
