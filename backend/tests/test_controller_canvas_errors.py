"""Error-contract tests for the canvas cluster (canvas / canvas_page / canvas_annotation).

Verifies that after migration each failure return carries code, category, and
message == code (dual-emit), proving error_response() wrapping was applied.

Style: direct controller calls, SimpleNamespace req, raw text() seed INSERTs.
Seed helpers cribbed verbatim from test_idor_canvas_page.py and test_idor_canvas_create.py.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import canvas as canvas_ctrl
from core.controller import canvas_page as page_ctrl
from core.controller import canvas_annotation as annotation_ctrl


def _req(user_id: int, username: str = "tester"):
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id, "username": username}))


# ---------------------------------------------------------------------------
# seed helpers — cribbed verbatim from test_idor_canvas_page.py
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


# seed helper for branch + membership (cribbed from test_idor_canvas_create.py)
async def _make_branch(db, created_by, name="Branch", key="BKEY"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    return row.scalar_one()


async def _add_branch_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_annotation(db, page_id, created_by):
    row = await db.execute(text("""
        INSERT INTO canvas_annotation
            (page_id, created_by, quoted_text, prefix_context, suffix_context,
             anchor_node_path, anchor_offset, anchor_length)
        VALUES (:p, :u, 'text', '', '', 'p[0]', 0, 4)
        RETURNING annotation_id
    """), {"p": page_id, "u": created_by})
    return row.scalar_one()


async def _make_reply(db, annotation_id, author_id, content="hello"):
    row = await db.execute(text("""
        INSERT INTO canvas_annotation_reply (annotation_id, author_id, content)
        VALUES (:a, :u, :c) RETURNING reply_id
    """), {"a": annotation_id, "u": author_id, "c": content})
    return row.scalar_one()


# ---------------------------------------------------------------------------
# Category: forbidden — canvas.get_detail ACCESS_DENIED (private, non-member)
# ---------------------------------------------------------------------------

async def test_canvas_get_detail_access_denied(db_session):
    """비멤버가 private canvas 조회 → ACCESS_DENIED (forbidden, dual-emit)."""
    alice = await _make_user(db_session, "alice_gd@cerr.test", "alice_gd")
    bob = await _make_user(db_session, "bob_gd@cerr.test", "bob_gd")

    canvas_id = await _make_canvas(db_session, alice, name="Private", key="CEPVT")
    await _add_member(db_session, canvas_id, alice, "admin")
    # bob is NOT a member

    res = await canvas_ctrl.get_detail(canvas_id, _req(bob), db_session)

    assert res["status"] is False
    assert res["code"] == "ACCESS_DENIED"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# Category: not_found — canvas.get_detail CANVAS_NOT_FOUND
# ---------------------------------------------------------------------------

async def test_canvas_get_detail_not_found(db_session):
    """존재하지 않는 canvas_id 조회 → CANVAS_NOT_FOUND (not_found, dual-emit)."""
    alice = await _make_user(db_session, "alice_nf@cerr.test", "alice_nf")

    res = await canvas_ctrl.get_detail(999999, _req(alice), db_session)

    assert res["status"] is False
    assert res["code"] == "CANVAS_NOT_FOUND"
    assert res["category"] == "not_found"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# Category: conflict — canvas.create KEY_ALREADY_EXISTS
# ---------------------------------------------------------------------------

async def test_canvas_create_key_already_exists(db_session):
    """이미 존재하는 key로 canvas 생성 → KEY_ALREADY_EXISTS (conflict, dual-emit)."""
    alice = await _make_user(db_session, "alice_key@cerr.test", "alice_key")
    # create first canvas with the key
    await _make_canvas(db_session, alice, name="First", key="DUPKEY")

    from routers.schema import canvas as canvas_schema
    res = await canvas_ctrl.create(
        canvas_schema.CanvasCreate(
            canvas_name="Second",
            key="DUPKEY",
            visibility="private",
            branch_id=None,
        ),
        _req(alice),
        db_session,
    )

    assert res["status"] is False
    assert res["code"] == "KEY_ALREADY_EXISTS"
    assert res["category"] == "conflict"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# Category: forbidden — canvas_page.create NOT_CANVAS_MEMBER
# ---------------------------------------------------------------------------

async def test_canvas_page_create_not_member(db_session):
    """캔버스 비멤버가 페이지 생성 → NOT_CANVAS_MEMBER (forbidden, dual-emit)."""
    alice = await _make_user(db_session, "alice_pm@cerr.test", "alice_pm")
    bob = await _make_user(db_session, "bob_pm@cerr.test", "bob_pm")

    canvas_id = await _make_canvas(db_session, alice, name="CM", key="CEPCM")
    await _add_member(db_session, canvas_id, alice, "admin")
    # bob is NOT a member

    from routers.schema import canvas_page as page_schema
    res = await page_ctrl.create(
        canvas_id,
        page_schema.CanvasPageCreate(title="Hacked", content="", type="document"),
        _req(bob),
        db_session,
    )

    assert res["status"] is False
    assert res["code"] == "NOT_CANVAS_MEMBER"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# Category: not_found — canvas_page.get_detail PAGE_NOT_FOUND
# ---------------------------------------------------------------------------

async def test_canvas_page_get_detail_page_not_found(db_session):
    """존재하지 않는 page_id 요청 → PAGE_NOT_FOUND (not_found, dual-emit)."""
    alice = await _make_user(db_session, "alice_pnf@cerr.test", "alice_pnf")
    canvas_id = await _make_canvas(db_session, alice, name="PNF", key="CEPNF")
    await _add_member(db_session, canvas_id, alice, "member")

    res = await page_ctrl.get_detail(canvas_id, 999999, _req(alice), db_session)

    assert res["status"] is False
    assert res["code"] == "PAGE_NOT_FOUND"
    assert res["category"] == "not_found"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# Category: business — canvas_page.delete CANNOT_DELETE_OVERVIEW
# ---------------------------------------------------------------------------

async def test_canvas_page_delete_overview_blocked(db_session):
    """overview 페이지 삭제 시도 → CANNOT_DELETE_OVERVIEW (business, dual-emit)."""
    alice = await _make_user(db_session, "alice_ov@cerr.test", "alice_ov")
    canvas_id = await _make_canvas(db_session, alice, name="OV", key="CEOV")
    await _add_member(db_session, canvas_id, alice, "member")
    overview_id = await _make_page(db_session, canvas_id, alice, title="Intro",
                                   page_type="overview")

    res = await page_ctrl.delete(canvas_id, overview_id, _req(alice), db_session)

    assert res["status"] is False
    assert res["code"] == "CANNOT_DELETE_OVERVIEW"
    assert res["category"] == "business"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# Category: conflict — canvas_page.move PARENT_CYCLE
# ---------------------------------------------------------------------------

async def test_canvas_page_move_parent_cycle(db_session):
    """페이지를 자기 자신 아래로 이동 → PARENT_CYCLE (conflict, dual-emit)."""
    alice = await _make_user(db_session, "alice_cyc@cerr.test", "alice_cyc")
    canvas_id = await _make_canvas(db_session, alice, name="CYC", key="CECYC")
    await _add_member(db_session, canvas_id, alice, "member")
    page_id = await _make_page(db_session, canvas_id, alice, title="Self")

    from routers.schema import canvas_page as page_schema
    res = await page_ctrl.move(
        canvas_id, page_id,
        page_schema.CanvasPageMove(parent_page_id=page_id, position=0),
        _req(alice), db_session,
    )

    assert res["status"] is False
    assert res["code"] == "PARENT_CYCLE"
    assert res["category"] == "conflict"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# Category: not_found — canvas_annotation.update_annotation ANNOTATION_NOT_FOUND
# ---------------------------------------------------------------------------

async def test_annotation_update_not_found(db_session):
    """존재하지 않는 annotation 업데이트 → ANNOTATION_NOT_FOUND (not_found, dual-emit)."""
    alice = await _make_user(db_session, "alice_annf@cerr.test", "alice_annf")
    canvas_id = await _make_canvas(db_session, alice, name="AN", key="CEAN")
    await _add_member(db_session, canvas_id, alice, "member")
    page_id = await _make_page(db_session, canvas_id, alice, title="P")

    from routers.schema import canvas_annotation as ann_schema
    res = await annotation_ctrl.update_annotation(
        ann_schema.AnnotationUpdate(status="resolved"),
        canvas_id, page_id, 999999,
        _req(alice), db_session,
    )

    assert res["status"] is False
    assert res["code"] == "ANNOTATION_NOT_FOUND"
    assert res["category"] == "not_found"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# Category: forbidden — canvas_annotation.delete_annotation NOT_ANNOTATION_AUTHOR
# ---------------------------------------------------------------------------

async def test_annotation_delete_not_author(db_session):
    """annotation 작성자가 아닌 멤버가 삭제 시도 → NOT_ANNOTATION_AUTHOR (forbidden, dual-emit)."""
    alice = await _make_user(db_session, "alice_na@cerr.test", "alice_na")
    bob = await _make_user(db_session, "bob_na@cerr.test", "bob_na")
    canvas_id = await _make_canvas(db_session, alice, name="NA", key="CENA")
    await _add_member(db_session, canvas_id, alice, "member")
    await _add_member(db_session, canvas_id, bob, "member")
    page_id = await _make_page(db_session, canvas_id, alice, title="P2")
    annotation_id = await _make_annotation(db_session, page_id, alice)

    # bob tries to delete alice's annotation
    res = await annotation_ctrl.delete_annotation(
        canvas_id, page_id, annotation_id, _req(bob), db_session
    )

    assert res["status"] is False
    assert res["code"] == "NOT_ANNOTATION_AUTHOR"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# Category: forbidden — canvas_annotation.delete_reply NOT_REPLY_AUTHOR
# ---------------------------------------------------------------------------

async def test_reply_delete_not_author(db_session):
    """reply 작성자가 아닌 멤버가 삭제 시도 → NOT_REPLY_AUTHOR (forbidden, dual-emit)."""
    alice = await _make_user(db_session, "alice_rna@cerr.test", "alice_rna")
    bob = await _make_user(db_session, "bob_rna@cerr.test", "bob_rna")
    canvas_id = await _make_canvas(db_session, alice, name="RNA", key="CERNA")
    await _add_member(db_session, canvas_id, alice, "member")
    await _add_member(db_session, canvas_id, bob, "member")
    page_id = await _make_page(db_session, canvas_id, alice, title="P3")
    annotation_id = await _make_annotation(db_session, page_id, alice)
    reply_id = await _make_reply(db_session, annotation_id, alice)

    # bob tries to delete alice's reply
    res = await annotation_ctrl.delete_reply(
        canvas_id, page_id, annotation_id, reply_id, _req(bob), db_session
    )

    assert res["status"] is False
    assert res["code"] == "NOT_REPLY_AUTHOR"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]
