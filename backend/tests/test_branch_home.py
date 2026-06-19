import contextlib
from datetime import date, timedelta

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import text

import db_engine
import main
from core.model import branch as branch_model


# ---------------------------------------------------------------------------
# seed helpers
# ---------------------------------------------------------------------------

async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Home Branch", key="HOME", color="#5E6AD2"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', :c, :u) RETURNING branch_id
    """), {"n": name, "k": key, "c": color, "u": created_by})
    bid = row.scalar_one()
    # default workflow statuses (todo/in_progress/done/cancelled)
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


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by, status="todo", due_date=None,
                     sprint_id=None, parent_task_id=None):
    # display_number must be unique per branch; use a per-call counter via max+1
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, due_date,
                          sprint_id, parent_task_id, created_by)
        VALUES (:b, :dn, :t, :s, :d, :sp, :pt, :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": f"task {dn}", "s": status,
           "d": due_date, "sp": sprint_id, "pt": parent_task_id, "u": created_by})
    return res.scalar_one()


async def _make_sprint(db, branch_id, created_by, name="Sprint 1", status="active"):
    res = await db.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, status, created_by)
        VALUES (:b, :n, :s, :u) RETURNING sprint_id
    """), {"b": branch_id, "n": name, "s": status, "u": created_by})
    return res.scalar_one()


# ---------------------------------------------------------------------------
# Task 1.1 — find_accessible enrichment (model level)
# ---------------------------------------------------------------------------

async def test_find_accessible_single_active_sprint_progress(db_session):
    owner = await _make_user(db_session, "owner@home.test", "owner")
    other = await _make_user(db_session, "mate@home.test", "mate")
    bid = await _make_branch(db_session, owner)
    await _add_member(db_session, bid, owner, "admin")
    await _add_member(db_session, bid, other, "member")

    sid = await _make_sprint(db_session, bid, owner, name="Sprint A", status="active")
    # 4 tasks IN the active sprint: 1 done + 1 cancelled (=2 terminal), 2 active => 50%
    await _make_task(db_session, bid, owner, status="done", sprint_id=sid)
    await _make_task(db_session, bid, owner, status="cancelled", sprint_id=sid)
    await _make_task(db_session, bid, owner, status="todo", sprint_id=sid)
    await _make_task(db_session, bid, owner, status="in_progress", sprint_id=sid)

    branches = await branch_model.find_accessible(owner, db_session)
    assert len(branches) == 1
    b = branches[0]

    assert b["progress_percent"] == 50
    assert b["active_sprint_count"] == 1
    assert b["active_sprint_name"] == "Sprint A"
    assert b["sprint_task_total"] == 4
    assert b["active_task_count"] == 2          # branch-wide non-terminal (todo + in_progress)
    assert "task_total" not in b                # cumulative fields removed
    assert "task_done" not in b
    assert "sprint_task_done" not in b          # internal, not exposed
    assert b["member_count"] == 2
    assert {m["name"] for m in b["members"]} == {"owner", "mate"}


async def test_find_accessible_no_active_sprint_progress_is_null(db_session):
    owner = await _make_user(db_session, "zero@home.test", "zero")
    bid = await _make_branch(db_session, owner, name="Empty", key="EMPTY")
    await _add_member(db_session, bid, owner, "admin")
    # one non-terminal task, NOT in any sprint
    await _make_task(db_session, bid, owner, status="todo")

    branches = await branch_model.find_accessible(owner, db_session)
    b = branches[0]
    assert b["progress_percent"] is None
    assert b["active_sprint_count"] == 0
    assert b["active_sprint_name"] is None
    assert b["sprint_task_total"] == 0
    assert b["active_task_count"] == 1


async def test_find_accessible_multiple_active_sprints_aggregate(db_session):
    owner = await _make_user(db_session, "multi@home.test", "multi")
    bid = await _make_branch(db_session, owner, name="Multi", key="MULTI")
    await _add_member(db_session, bid, owner, "admin")

    sa = await _make_sprint(db_session, bid, owner, name="Sprint A", status="active")
    sb = await _make_sprint(db_session, bid, owner, name="Sprint B", status="active")
    # Sprint A: 1 done + 1 todo ; Sprint B: 2 done  => terminal 3 / total 4 => 75%
    await _make_task(db_session, bid, owner, status="done", sprint_id=sa)
    await _make_task(db_session, bid, owner, status="todo", sprint_id=sa)
    await _make_task(db_session, bid, owner, status="done", sprint_id=sb)
    await _make_task(db_session, bid, owner, status="done", sprint_id=sb)

    branches = await branch_model.find_accessible(owner, db_session)
    b = branches[0]
    assert b["active_sprint_count"] == 2
    assert b["active_sprint_name"] is None       # ambiguous when >1 active
    assert b["sprint_task_total"] == 4
    assert b["progress_percent"] == 75
    assert b["active_task_count"] == 1           # the single todo


async def test_find_accessible_subtasks_excluded(db_session):
    owner = await _make_user(db_session, "sub@home.test", "sub")
    bid = await _make_branch(db_session, owner, name="Sub", key="SUB")
    await _add_member(db_session, bid, owner, "admin")
    sid = await _make_sprint(db_session, bid, owner, name="S", status="active")

    parent = await _make_task(db_session, bid, owner, status="todo", sprint_id=sid)
    # subtask in same sprint — must NOT be counted
    await _make_task(db_session, bid, owner, status="todo", sprint_id=sid,
                     parent_task_id=parent)

    branches = await branch_model.find_accessible(owner, db_session)
    b = branches[0]
    assert b["sprint_task_total"] == 1           # only the top-level parent
    assert b["active_task_count"] == 1


async def test_find_accessible_closed_sprint_excluded(db_session):
    owner = await _make_user(db_session, "closed@home.test", "closed")
    bid = await _make_branch(db_session, owner, name="Closed", key="CLOSED")
    await _add_member(db_session, bid, owner, "admin")
    closed = await _make_sprint(db_session, bid, owner, name="Old", status="closed")
    await _make_task(db_session, bid, owner, status="done", sprint_id=closed)
    await _make_task(db_session, bid, owner, status="todo", sprint_id=closed)

    branches = await branch_model.find_accessible(owner, db_session)
    b = branches[0]
    assert b["active_sprint_count"] == 0
    assert b["progress_percent"] is None         # no active sprint
    assert b["sprint_task_total"] == 0
    assert b["active_task_count"] == 1           # closed sprint's todo is still non-terminal


async def test_find_accessible_members_capped_at_four(db_session):
    owner = await _make_user(db_session, "cap-owner@home.test", "capowner")
    bid = await _make_branch(db_session, owner, name="Big", key="BIG")
    await _add_member(db_session, bid, owner, "admin")
    for i in range(5):
        u = await _make_user(db_session, f"cap{i}@home.test", f"cap{i}")
        await _add_member(db_session, bid, u, "member")

    branches = await branch_model.find_accessible(owner, db_session)
    b = branches[0]
    assert b["member_count"] == 6
    assert len(b["members"]) == 4


# ---------------------------------------------------------------------------
# Task 1.2 — GET /api/branches/home-stats (route level)
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
    owner = await _make_user(db_session, "stats@home.test", "statsowner")
    raw = await _make_token(db_session, owner, "wv_home_stats_token")
    headers = {"Authorization": f"Bearer {raw}"}

    bid = await _make_branch(db_session, owner, name="Stats", key="STATS")
    await _add_member(db_session, bid, owner, "admin")

    # 2 active sprints
    await _make_sprint(db_session, bid, owner, name="S1", status="active")
    await _make_sprint(db_session, bid, owner, name="S2", status="active")
    # 1 future sprint (not counted)
    await _make_sprint(db_session, bid, owner, name="S3", status="future")

    this_week = date.today() + timedelta(days=3)
    next_month = date.today() + timedelta(days=40)

    # open (todo): 2  — one of them due this week
    await _make_task(db_session, bid, owner, status="todo", due_date=this_week)
    await _make_task(db_session, bid, owner, status="todo", due_date=next_month)
    # in_progress: 3 — one due this week
    await _make_task(db_session, bid, owner, status="in_progress", due_date=this_week)
    await _make_task(db_session, bid, owner, status="in_progress")
    await _make_task(db_session, bid, owner, status="in_progress")
    # done/cancelled: not open, not in_progress, not due-this-week (even if due date set)
    await _make_task(db_session, bid, owner, status="done", due_date=this_week)
    await _make_task(db_session, bid, owner, status="cancelled")

    res = await client.get("/api/branches/home-stats", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] is True
    assert body["open_count"] == 2
    assert body["in_progress_count"] == 3
    # due this week counts only incomplete tasks (todo x1 + in_progress x1)
    assert body["due_this_week_count"] == 2
    assert body["active_sprint_count"] == 2


async def test_home_stats_requires_auth(client):
    res = await client.get("/api/branches/home-stats")
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# Task 2 — GET /api/branches/home-stats/items (드릴인 엔드포인트)
# ---------------------------------------------------------------------------

async def test_home_stats_items_due_this_week(db_session, client):
    db = db_session
    uid = await _make_user(db, "items1@test.com", "items1")
    bid = await _make_branch(db, uid, "백엔드", "BE", "#16A34A")
    await _add_member(db, bid, uid, "owner")
    # due 안: 오늘(D-day), +3일 / due 밖: +10일(주간 밖), 과거(-1) → 과거는 제외(>= CURRENT_DATE)
    # tz 흔들림 방지: 기준일을 Python date.today() 대신 DB CURRENT_DATE 로 잡는다(컨테이너/DB 시간대 차).
    from datetime import timedelta
    today = (await db.execute(text("SELECT CURRENT_DATE"))).scalar()
    await _make_task(db, bid, uid, status="todo", due_date=today)
    await _make_task(db, bid, uid, status="todo", due_date=today + timedelta(days=3))
    await _make_task(db, bid, uid, status="todo", due_date=today + timedelta(days=10))
    await _make_task(db, bid, uid, status="todo", due_date=today - timedelta(days=1))
    raw = await _make_token(db, uid, "tok_items_due_aaaaaaaaaaaaaaaaaaaa")
    headers = {"Authorization": f"Bearer {raw}"}

    res = await client.get("/api/branches/home-stats/items?bucket=due_this_week", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] is True
    assert body["bucket"] == "due_this_week"
    assert body["total_count"] == 2
    assert len(body["items"]) == 2
    # 임박순 정렬: 오늘(D-day)이 +3일보다 먼저
    assert body["items"][0]["due_date"] == today.isoformat()
    assert body["items"][1]["due_date"] == (today + timedelta(days=3)).isoformat()
    # 행에 브랜치명 포함
    assert body["items"][0]["branch_name"] == "백엔드"


async def test_home_stats_items_open_matches_count(db_session, client):
    db = db_session
    uid = await _make_user(db, "items2@test.com", "items2")
    bid = await _make_branch(db, uid, "코어", "CORE", "#5E6AD2")
    await _add_member(db, bid, uid, "owner")
    await _make_task(db, bid, uid, status="todo")                 # open
    await _make_task(db, bid, uid, status="todo")                 # open
    await _make_task(db, bid, uid, status="in_progress")          # in_progress (open 아님)
    await _make_task(db, bid, uid, status="done")                 # 제외
    raw = await _make_token(db, uid, "tok_items_open_bbbbbbbbbbbbbbbbbbbb")
    headers = {"Authorization": f"Bearer {raw}"}

    count_res = await client.get("/api/branches/home-stats", headers=headers)
    items_res = await client.get("/api/branches/home-stats/items?bucket=open", headers=headers)
    assert items_res.json()["total_count"] == count_res.json()["open_count"] == 2
    assert {i["status_category"] for i in items_res.json()["items"]} == {"todo"}


async def test_home_stats_items_member_scope(db_session, client):
    """다른 사람 브랜치(내가 멤버 아님)의 태스크는 목록에서 제외."""
    db = db_session
    me = await _make_user(db, "items3@test.com", "items3")
    other = await _make_user(db, "items3b@test.com", "items3b")
    my_b = await _make_branch(db, me, "내브랜치", "MINE", "#16A34A")
    await _add_member(db, my_b, me, "owner")
    their_b = await _make_branch(db, other, "남브랜치", "THEIRS", "#DC2626")
    await _add_member(db, their_b, other, "owner")
    await _make_task(db, my_b, me, status="todo")
    await _make_task(db, their_b, other, status="todo")
    raw = await _make_token(db, me, "tok_items_scope_cccccccccccccccccccc")
    headers = {"Authorization": f"Bearer {raw}"}

    res = await client.get("/api/branches/home-stats/items?bucket=open", headers=headers)
    assert res.json()["total_count"] == 1
    assert res.json()["items"][0]["branch_name"] == "내브랜치"


async def test_home_stats_items_invalid_bucket(db_session, client):
    db = db_session
    uid = await _make_user(db, "items4@test.com", "items4")
    raw = await _make_token(db, uid, "tok_items_bad_dddddddddddddddddddddd")
    headers = {"Authorization": f"Bearer {raw}"}
    res = await client.get("/api/branches/home-stats/items?bucket=nope", headers=headers)
    assert res.json()["status"] is False
    assert res.json()["message"] == "INVALID_BUCKET"
