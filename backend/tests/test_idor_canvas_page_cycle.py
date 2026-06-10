"""Canvas page tree-cycle + update parent-path tests (CP-001/002/003/004).

Closes the review findings that the canvas_page tree had two parent-changing
paths (move, update) with NO cycle guard, and that PATCH update() also bypassed
the LOG-02 canvas-membership check on parent_page_id.

Decisions implemented here:
  * move() now rejects self-parent and descendant-parent with PARENT_CYCLE
    (model.is_circular_parent recursive-CTE helper, depth-limited).
  * CanvasPageUpdate schema dropped parent_page_id (and position); parent change
    is move-only. model.update() additionally whitelists fields as a second
    block. The frontend never sends parent_page_id via the bare update PATCH
    (only via /move and create) — verified by grep — so this is non-breaking.

Style: direct controller-level calls, raw-INSERT seeding on the rollback-isolated
``db_session`` fixture. Mirrors test_idor_canvas_page.py.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import canvas_page as ctrl
from core.model import canvas_page as page_model
from routers.schema import canvas_page as schema


def _req(user_id: int):
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
# move — self-parent cycle (CP-001)
# ---------------------------------------------------------------------------

async def test_move_rejects_self_parent(db_session):
    """페이지를 자기 자신 아래로 이동 → PARENT_CYCLE, DB 부모 불변."""
    alice = await _make_user(db_session, "alice_self@cyc.test", "alice_self")
    canvas = await _make_canvas(db_session, alice, name="SELF", key="CYSELF")
    await _add_member(db_session, canvas, alice, "member")
    page = await _make_page(db_session, canvas, alice, title="Self")

    res = await ctrl.move(
        canvas, page,
        schema.CanvasPageMove(parent_page_id=page, position=0),
        _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "PARENT_CYCLE"

    after = await _page_row(db_session, page)
    assert after["parent_page_id"] is None


# ---------------------------------------------------------------------------
# move — descendant-parent cycle (CP-001/003/004)
# ---------------------------------------------------------------------------

async def test_move_rejects_descendant_as_parent(db_session):
    """A 아래 B를 만든 뒤 A를 B 아래로 이동 → PARENT_CYCLE, DB 부모 불변."""
    alice = await _make_user(db_session, "alice_desc@cyc.test", "alice_desc")
    canvas = await _make_canvas(db_session, alice, name="DESC", key="CYDESC")
    await _add_member(db_session, canvas, alice, "member")

    page_a = await _make_page(db_session, canvas, alice, title="A", page_type="folder")
    page_b = await _make_page(db_session, canvas, alice, title="B",
                              parent_page_id=page_a, page_type="folder")

    # A를 B(자기 후손) 아래로 → 사이클
    res = await ctrl.move(
        canvas, page_a,
        schema.CanvasPageMove(parent_page_id=page_b, position=0),
        _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "PARENT_CYCLE"

    # A는 여전히 루트, B는 여전히 A 아래 (불변)
    after_a = await _page_row(db_session, page_a)
    after_b = await _page_row(db_session, page_b)
    assert after_a["parent_page_id"] is None
    assert after_b["parent_page_id"] == page_a


async def test_move_rejects_deep_descendant_as_parent(db_session):
    """A>B>C 트리에서 A를 C(깊은 후손) 아래로 이동 → PARENT_CYCLE."""
    alice = await _make_user(db_session, "alice_deep@cyc.test", "alice_deep")
    canvas = await _make_canvas(db_session, alice, name="DEEP", key="CYDEEP")
    await _add_member(db_session, canvas, alice, "member")

    page_a = await _make_page(db_session, canvas, alice, title="A", page_type="folder")
    page_b = await _make_page(db_session, canvas, alice, title="B",
                              parent_page_id=page_a, page_type="folder")
    page_c = await _make_page(db_session, canvas, alice, title="C",
                              parent_page_id=page_b, page_type="folder")

    res = await ctrl.move(
        canvas, page_a,
        schema.CanvasPageMove(parent_page_id=page_c, position=0),
        _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "PARENT_CYCLE"

    after_a = await _page_row(db_session, page_a)
    assert after_a["parent_page_id"] is None


# ---------------------------------------------------------------------------
# update — parent_page_id path blocked (CP-002)
# ---------------------------------------------------------------------------

async def test_update_schema_drops_parent_page_id(db_session):
    """CanvasPageUpdate는 parent_page_id를 무시(스키마에서 제거)해야 한다."""
    body = schema.CanvasPageUpdate(title="renamed", parent_page_id=999, position=5)
    fields = body.model_dump(exclude_unset=True)
    assert "parent_page_id" not in fields
    assert "position" not in fields
    assert fields.get("title") == "renamed"


async def test_update_ignores_parent_page_id_even_if_passed_to_model(db_session):
    """모델 update()가 parent_page_id를 받아도 화이트리스트로 차단 (이중 방어)."""
    alice = await _make_user(db_session, "alice_upd@cyc.test", "alice_upd")
    canvas = await _make_canvas(db_session, alice, name="UPD", key="CYUPD")
    await _add_member(db_session, canvas, alice, "member")

    page_a = await _make_page(db_session, canvas, alice, title="A", page_type="folder")
    page_b = await _make_page(db_session, canvas, alice, title="B", parent_page_id=page_a)

    # 화이트리스트가 없으면 cross-canvas/사이클 부모를 직접 쓸 수 있었다.
    # B의 부모를 자기 자신으로 바꾸려는 악성 payload + 정상 title 변경.
    await page_model.update(
        page_b, {"title": "B-renamed", "parent_page_id": page_b, "position": 99},
        alice, db_session,
    )

    after = await _page_row(db_session, page_b)
    assert after["title"] == "B-renamed"      # 화이트리스트 필드는 적용
    assert after["parent_page_id"] == page_a  # 부모는 불변 (parent_page_id 무시)


async def test_update_controller_keeps_parent_unchanged(db_session):
    """update() 컨트롤러로 페이지를 수정해도 부모는 절대 바뀌지 않는다."""
    alice = await _make_user(db_session, "alice_uc@cyc.test", "alice_uc")
    canvas = await _make_canvas(db_session, alice, name="UC", key="CYUC")
    await _add_member(db_session, canvas, alice, "member")

    page_a = await _make_page(db_session, canvas, alice, title="A", page_type="folder")
    page_b = await _make_page(db_session, canvas, alice, title="B", parent_page_id=page_a)

    res = await ctrl.update(
        canvas, page_b,
        schema.CanvasPageUpdate(title="B-updated"),
        _req(alice), db_session,
    )
    assert res["status"] is True

    after = await _page_row(db_session, page_b)
    assert after["title"] == "B-updated"
    assert after["parent_page_id"] == page_a


# ---------------------------------------------------------------------------
# regression — legitimate (acyclic) moves still succeed
# ---------------------------------------------------------------------------

async def test_move_to_sibling_folder_succeeds(db_session):
    """같은 canvas 내 비순환 부모 이동은 정상 (회귀)."""
    alice = await _make_user(db_session, "alice_ok@cyc.test", "alice_ok")
    canvas = await _make_canvas(db_session, alice, name="OK", key="CYOK")
    await _add_member(db_session, canvas, alice, "member")

    folder = await _make_page(db_session, canvas, alice, title="Folder", page_type="folder")
    doc = await _make_page(db_session, canvas, alice, title="Doc")

    res = await ctrl.move(
        canvas, doc,
        schema.CanvasPageMove(parent_page_id=folder, position=0),
        _req(alice), db_session,
    )
    assert res["status"] is True
    after = await _page_row(db_session, doc)
    assert after["parent_page_id"] == folder


async def test_move_to_root_succeeds(db_session):
    """부모를 None(루트)로 이동 → 사이클 검사 통과, 정상 (회귀)."""
    alice = await _make_user(db_session, "alice_root@cyc.test", "alice_root")
    canvas = await _make_canvas(db_session, alice, name="ROOT", key="CYROOT")
    await _add_member(db_session, canvas, alice, "member")

    folder = await _make_page(db_session, canvas, alice, title="Folder", page_type="folder")
    doc = await _make_page(db_session, canvas, alice, title="Doc", parent_page_id=folder)

    res = await ctrl.move(
        canvas, doc,
        schema.CanvasPageMove(parent_page_id=None, position=0),
        _req(alice), db_session,
    )
    assert res["status"] is True
    after = await _page_row(db_session, doc)
    assert after["parent_page_id"] is None


async def test_move_parent_into_unrelated_subtree_succeeds(db_session):
    """A>B 와 별개의 C가 있을 때 A를 C 아래로 이동(비순환) → 정상 (회귀)."""
    alice = await _make_user(db_session, "alice_un@cyc.test", "alice_un")
    canvas = await _make_canvas(db_session, alice, name="UN", key="CYUN")
    await _add_member(db_session, canvas, alice, "member")

    page_a = await _make_page(db_session, canvas, alice, title="A", page_type="folder")
    await _make_page(db_session, canvas, alice, title="B",
                     parent_page_id=page_a, page_type="folder")
    page_c = await _make_page(db_session, canvas, alice, title="C", page_type="folder")

    # A를 C(후손 아님) 아래로 → 허용
    res = await ctrl.move(
        canvas, page_a,
        schema.CanvasPageMove(parent_page_id=page_c, position=0),
        _req(alice), db_session,
    )
    assert res["status"] is True
    after_a = await _page_row(db_session, page_a)
    assert after_a["parent_page_id"] == page_c


# ---------------------------------------------------------------------------
# helper unit — is_circular_parent direct
# ---------------------------------------------------------------------------

async def test_is_circular_parent_helper(db_session):
    alice = await _make_user(db_session, "alice_h@cyc.test", "alice_h")
    canvas = await _make_canvas(db_session, alice, name="H", key="CYH")
    await _add_member(db_session, canvas, alice, "member")

    page_a = await _make_page(db_session, canvas, alice, title="A", page_type="folder")
    page_b = await _make_page(db_session, canvas, alice, title="B",
                              parent_page_id=page_a, page_type="folder")
    page_c = await _make_page(db_session, canvas, alice, title="C", page_type="folder")

    # None → 사이클 아님
    assert await page_model.is_circular_parent(page_a, None, db_session) is False
    # self → 사이클
    assert await page_model.is_circular_parent(page_a, page_a, db_session) is True
    # descendant(B) → 사이클
    assert await page_model.is_circular_parent(page_a, page_b, db_session) is True
    # unrelated(C) → 사이클 아님
    assert await page_model.is_circular_parent(page_a, page_c, db_session) is False
    # 정상 방향 (B를 C 아래로) → 사이클 아님
    assert await page_model.is_circular_parent(page_b, page_c, db_session) is False
