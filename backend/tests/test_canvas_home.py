import contextlib
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import text

import db_engine
import main
from core.model import canvas as canvas_model


# ---------------------------------------------------------------------------
# seed helpers
# ---------------------------------------------------------------------------

async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_canvas(db, created_by, name="Home Canvas", key="HOMEC", color="#16A34A"):
    row = await db.execute(text("""
        INSERT INTO canvas (canvas_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', :c, :u) RETURNING canvas_id
    """), {"n": name, "k": key, "c": color, "u": created_by})
    return row.scalar_one()


async def _add_member(db, canvas_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO canvas_member (canvas_id, user_id, role)
        VALUES (:c, :u, :r)
    """), {"c": canvas_id, "u": user_id, "r": role})


async def _make_page(db, canvas_id, created_by, updated_by=None,
                     updated_at=None, title="page"):
    """Insert a page. updated_at can be a tz-aware datetime to control last_edited."""
    res = await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, position,
                                 created_by, updated_by, updated_at)
        VALUES (:c, :t, '<p></p>', 0, :cb, :ub, :ua)
        RETURNING page_id
    """), {"c": canvas_id, "t": title, "cb": created_by,
           "ub": updated_by if updated_by is not None else created_by,
           "ua": updated_at})
    return res.scalar_one()


async def _add_star(db, user_id, item_type, item_id):
    await db.execute(text("""
        INSERT INTO user_star (user_id, item_type, item_id)
        VALUES (:u, :t, :i)
    """), {"u": user_id, "t": item_type, "i": item_id})


# ---------------------------------------------------------------------------
# Task 2.1 — find_accessible enrichment (model level)
# ---------------------------------------------------------------------------

async def test_find_accessible_enriches_canvas_cards(db_session):
    owner = await _make_user(db_session, "cowner@chome.test", "cowner")
    editor = await _make_user(db_session, "ceditor@chome.test", "ceditor")
    cid = await _make_canvas(db_session, owner)
    await _add_member(db_session, cid, owner, "admin")
    await _add_member(db_session, cid, editor, "member")

    now = datetime.now(timezone.utc)
    old = now - timedelta(days=10)
    recent = now - timedelta(hours=1)

    # 3 pages; page edited by editor is the most recently updated
    await _make_page(db_session, cid, owner, updated_at=old, title="p1")
    await _make_page(db_session, cid, owner, updated_at=now - timedelta(days=2), title="p2")
    await _make_page(db_session, cid, owner, updated_by=editor, updated_at=recent, title="p3")

    canvases = await canvas_model.find_accessible(owner, db_session)
    assert len(canvases) == 1
    c = canvases[0]

    assert c["page_count"] == 3
    # last_edited_at is the MAX(updated_at) across pages == the recent (p3) edit,
    # not the 10-day-old p1. Returned tz-aware (UTC).
    assert c["last_edited_at"] is not None
    assert c["last_edited_at"] >= now - timedelta(hours=2)
    assert c["last_edited_at"] < now + timedelta(minutes=1)

    # contributors are distinct page authors (created_by ∪ updated_by): owner + editor
    assert c["contributor_count"] == 2
    assert isinstance(c["contributors"], list)
    assert len(c["contributors"]) == 2
    assert {m["name"] for m in c["contributors"]} == {"cowner", "ceditor"}
    for m in c["contributors"]:
        assert m["color"] and m["color"].startswith("#")


async def test_find_accessible_no_pages_defaults(db_session):
    owner = await _make_user(db_session, "empty@chome.test", "cempty")
    cid = await _make_canvas(db_session, owner, name="Empty", key="EMPTYC")
    await _add_member(db_session, cid, owner, "admin")

    canvases = await canvas_model.find_accessible(owner, db_session)
    c = canvases[0]
    assert c["page_count"] == 0
    assert c["last_edited_at"] is None
    assert c["contributor_count"] == 0
    assert c["contributors"] == []


async def test_find_accessible_contributors_capped_at_four(db_session):
    owner = await _make_user(db_session, "cap-cowner@chome.test", "capcowner")
    cid = await _make_canvas(db_session, owner, name="Big", key="BIGC")
    await _add_member(db_session, cid, owner, "admin")

    # 6 distinct authors → contributor_count 6, contributors capped at 4
    for i in range(6):
        u = await _make_user(db_session, f"capc{i}@chome.test", f"capc{i}")
        await _make_page(db_session, cid, u, title=f"p{i}")

    canvases = await canvas_model.find_accessible(owner, db_session)
    c = canvases[0]
    assert c["page_count"] == 6
    assert c["contributor_count"] == 6
    assert len(c["contributors"]) == 4


# ---------------------------------------------------------------------------
# Task 2.2 — GET /api/canvases/home-stats (route level)
# ---------------------------------------------------------------------------

@pytest.fixture
async def client(db_session, monkeypatch):
    @contextlib.asynccontextmanager
    async def _fake_txn_session():
        yield db_session

    async def _override_session():
        yield db_session

    monkeypatch.setattr(db_engine, "transactional_session", _fake_txn_session)
    main.app.dependency_overrides[db_engine.session] = _override_session
    try:
        transport = ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c
    finally:
        main.app.dependency_overrides.pop(db_engine.session, None)


async def _make_token(db, user_id, raw):
    from library import crypto
    await db.execute(text("""
        INSERT INTO personal_access_token (user_id, name, token_hash, token_prefix)
        VALUES (:uid, 'home', :h, :p)
    """), {"uid": user_id, "h": crypto.hash_token(raw), "p": raw[:11]})
    return raw


async def test_home_stats(client, db_session):
    owner = await _make_user(db_session, "cstats@chome.test", "cstatsowner")
    raw = await _make_token(db_session, owner, "wv_chome_stats_tok")
    headers = {"Authorization": f"Bearer {raw}"}

    cid = await _make_canvas(db_session, owner, name="Stats", key="STATSC")
    await _add_member(db_session, cid, owner, "admin")

    now = datetime.now(timezone.utc)
    this_week = now - timedelta(days=2)
    old = now - timedelta(days=30)

    # 4 pages: 2 edited this week, 2 edited long ago
    p1 = await _make_page(db_session, cid, owner, updated_at=this_week, title="recent1")
    p2 = await _make_page(db_session, cid, owner, updated_at=this_week, title="recent2")
    p3 = await _make_page(db_session, cid, owner, updated_at=old, title="old1")
    await _make_page(db_session, cid, owner, updated_at=old, title="old2")

    # stars: 2 doc stars (counted) + 1 task star (not counted)
    await _add_star(db_session, owner, "doc", p1)
    await _add_star(db_session, owner, "doc", p2)
    await _add_star(db_session, owner, "task", 999)

    res = await client.get("/api/canvases/home-stats", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] is True
    assert body["total_docs"] == 4
    assert body["edited_this_week"] == 2
    assert body["starred_count"] == 2
    # no doc/page mention mechanism exists in the schema → omitted
    assert "mention_count" not in body


async def test_home_stats_requires_auth(client):
    res = await client.get("/api/canvases/home-stats")
    assert res.status_code == 401
