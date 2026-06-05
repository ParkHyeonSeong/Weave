import contextlib
from datetime import date, timedelta

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import text

import db_engine
import main
from core.model import track as track_model


# ---------------------------------------------------------------------------
# seed helpers
# ---------------------------------------------------------------------------

async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Track Branch", key="TBR", color="#5E6AD2"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', :c, :u) RETURNING branch_id
    """), {"n": name, "k": key, "c": color, "u": created_by})
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


async def _make_track(db, created_by, name="Home Track", color="#0D9488"):
    row = await db.execute(text("""
        INSERT INTO track (track_name, description, color, visibility, default_view, created_by)
        VALUES (:n, 'desc', :c, 'private', 'flow', :u) RETURNING track_id
    """), {"n": name, "c": color, "u": created_by})
    return row.scalar_one()


async def _add_track_member(db, track_id, user_id, role="owner"):
    await db.execute(text("""
        INSERT INTO track_member (track_id, user_id, role)
        VALUES (:t, :u, :r)
    """), {"t": track_id, "u": user_id, "r": role})


async def _link_branch(db, track_id, branch_id, name_override=None, color_override=None):
    await db.execute(text("""
        INSERT INTO track_branch (track_id, branch_id, display_name_override, color_override)
        VALUES (:t, :b, :n, :c)
    """), {"t": track_id, "b": branch_id, "n": name_override, "c": color_override})


async def _make_task(db, branch_id, created_by, status="todo", due_date=None):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, due_date, created_by)
        VALUES (:b, :dn, :t, :s, :d, :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": f"task {dn}", "s": status,
           "d": due_date, "u": created_by})
    return res.scalar_one()


async def _add_track_item(db, track_id, task_id):
    await db.execute(text("""
        INSERT INTO track_item (track_id, source_type, source_task_id, position_x, position_y)
        VALUES (:t, 'task', :task, 0, 0)
    """), {"t": track_id, "task": task_id})


# ---------------------------------------------------------------------------
# Task 3.1 — find_accessible enrichment (model level)
# ---------------------------------------------------------------------------

async def test_find_accessible_enriches_track_cards(db_session):
    owner = await _make_user(db_session, "towner@thome.test", "towner")
    tid = await _make_track(db_session, owner)
    await _add_track_member(db_session, tid, owner, "owner")

    bid = await _make_branch(db_session, owner, name="Core", key="CORE", color="#5E6AD2")
    await _add_branch_member(db_session, bid, owner, "admin")
    # linked branch with name + color override
    await _link_branch(db_session, tid, bid, name_override="Renamed", color_override="#FF0000")

    # 4 tasks in the track: 1 done, 1 cancelled (=2 done), 2 incomplete => 50%
    for status in ("done", "cancelled", "todo", "in_progress"):
        task_id = await _make_task(db_session, bid, owner, status=status)
        await _add_track_item(db_session, tid, task_id)

    tracks = await track_model.find_accessible(owner, db_session)
    assert len(tracks) == 1
    t = tracks[0]

    assert t["item_count"] == 4
    assert t["branch_count"] == 1
    assert t["progress_percent"] == 50

    assert isinstance(t["branches"], list)
    assert len(t["branches"]) == 1
    br = t["branches"][0]
    # override名/색이 우선
    assert br["name"] == "Renamed"
    assert br["color"] == "#FF0000"


async def test_find_accessible_zero_tasks_progress_is_zero(db_session):
    owner = await _make_user(db_session, "tzero@thome.test", "tzero")
    tid = await _make_track(db_session, owner, name="Empty")
    await _add_track_member(db_session, tid, owner, "owner")

    tracks = await track_model.find_accessible(owner, db_session)
    t = tracks[0]
    assert t["item_count"] == 0
    assert t["branch_count"] == 0
    assert t["progress_percent"] == 0
    assert t["branches"] == []


async def test_find_accessible_branches_capped_at_three(db_session):
    owner = await _make_user(db_session, "tcap@thome.test", "tcap")
    tid = await _make_track(db_session, owner, name="Big")
    await _add_track_member(db_session, tid, owner, "owner")

    # link 4 branches → branch_count 4, branches preview capped at 3
    for i in range(4):
        bid = await _make_branch(db_session, owner, name=f"B{i}", key=f"BB{i}")
        await _add_branch_member(db_session, bid, owner, "admin")
        await _link_branch(db_session, tid, bid)

    tracks = await track_model.find_accessible(owner, db_session)
    t = tracks[0]
    assert t["branch_count"] == 4
    assert len(t["branches"]) == 3
    for br in t["branches"]:
        assert br["name"]
        assert br["color"] and br["color"].startswith("#")


async def test_find_accessible_branch_real_name_when_no_override(db_session):
    owner = await _make_user(db_session, "tnov@thome.test", "tnov")
    tid = await _make_track(db_session, owner, name="NoOverride")
    await _add_track_member(db_session, tid, owner, "owner")

    bid = await _make_branch(db_session, owner, name="RealName", key="REAL", color="#123456")
    await _add_branch_member(db_session, bid, owner, "admin")
    await _link_branch(db_session, tid, bid)  # no overrides

    tracks = await track_model.find_accessible(owner, db_session)
    t = tracks[0]
    assert len(t["branches"]) == 1
    assert t["branches"][0]["name"] == "RealName"
    assert t["branches"][0]["color"] == "#123456"


# ---------------------------------------------------------------------------
# Task 3.2 — GET /api/tracks/home-stats (route level)
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
    owner = await _make_user(db_session, "tstats@thome.test", "tstatsowner")
    raw = await _make_token(db_session, owner, "wv_thome_stats_tok")
    headers = {"Authorization": f"Bearer {raw}"}

    tid = await _make_track(db_session, owner, name="Stats")
    await _add_track_member(db_session, tid, owner, "owner")

    bid = await _make_branch(db_session, owner, name="StatsB", key="STB")
    await _add_branch_member(db_session, bid, owner, "admin")
    await _link_branch(db_session, tid, bid)

    this_week = date.today() + timedelta(days=3)
    next_month = date.today() + timedelta(days=40)

    # in_progress: 3 — one due this week
    for due in (this_week, None, None):
        task_id = await _make_task(db_session, bid, owner, status="in_progress", due_date=due)
        await _add_track_item(db_session, tid, task_id)
    # todo: 2 — one due this week
    for due in (this_week, next_month):
        task_id = await _make_task(db_session, bid, owner, status="todo", due_date=due)
        await _add_track_item(db_session, tid, task_id)
    # done/cancelled — completed: not in_progress, not due-this-week even with due date
    for status in ("done", "cancelled"):
        task_id = await _make_task(db_session, bid, owner, status=status, due_date=this_week)
        await _add_track_item(db_session, tid, task_id)

    res = await client.get("/api/tracks/home-stats", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] is True
    assert body["active_track_count"] == 1
    assert body["connected_branch_count"] == 1
    assert body["in_progress_task_count"] == 3
    # incomplete tasks due this week: in_progress x1 + todo x1
    assert body["due_this_week_count"] == 2


async def test_home_stats_distinct_branches(client, db_session):
    """Same branch linked across two tracks counts once."""
    owner = await _make_user(db_session, "tdist@thome.test", "tdistowner")
    raw = await _make_token(db_session, owner, "wv_tdist_stat_tok")
    headers = {"Authorization": f"Bearer {raw}"}

    bid = await _make_branch(db_session, owner, name="Shared", key="SHR")
    await _add_branch_member(db_session, bid, owner, "admin")

    t1 = await _make_track(db_session, owner, name="T1")
    await _add_track_member(db_session, t1, owner, "owner")
    await _link_branch(db_session, t1, bid)

    t2 = await _make_track(db_session, owner, name="T2")
    await _add_track_member(db_session, t2, owner, "owner")
    await _link_branch(db_session, t2, bid)

    res = await client.get("/api/tracks/home-stats", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["active_track_count"] == 2
    assert body["connected_branch_count"] == 1  # distinct


async def test_home_stats_requires_auth(client):
    res = await client.get("/api/tracks/home-stats")
    assert res.status_code == 401
