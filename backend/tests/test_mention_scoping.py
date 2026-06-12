"""SEC-09: @멘션 검색이 호출자가 멤버인 범위(방/브랜치/캔버스)로만 스코핑되는지.

- 범위가 없으면 빈 결과(전체 사용자 열거 방지)
- 호출자가 그 범위의 멤버가 아니면 빈 결과
- 멘션/디렉터리 응답에서 email 필드 제거
"""
from types import SimpleNamespace

import bcrypt
from sqlalchemy import text

from core.controller import chat as chat_controller


def _req(uid):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': uid}))


async def _user(db, username, email):
    pw = bcrypt.hashpw(b"x", bcrypt.gensalt())
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES (:e, :p, :u, 'active', 'member') RETURNING user_id
    """), {"e": email, "p": pw, "u": username})
    return row.scalar_one()


async def _branch(db, creator, key):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES ('B', :k, 'd', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"k": key, "u": creator})
    return row.scalar_one()


async def _branch_member(db, branch_id, user_id, role='member'):
    await db.execute(text(
        "INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, :r)"
    ), {"b": branch_id, "u": user_id, "r": role})


async def _canvas(db, branch_id, creator, key):
    row = await db.execute(text("""
        INSERT INTO canvas (branch_id, canvas_name, key, visibility, created_by)
        VALUES (:b, 'C', :k, 'private', :u) RETURNING canvas_id
    """), {"b": branch_id, "k": key, "u": creator})
    return row.scalar_one()


async def _canvas_member(db, canvas_id, user_id, role='member'):
    await db.execute(text(
        "INSERT INTO canvas_member (canvas_id, user_id, role) VALUES (:c, :u, :r)"
    ), {"c": canvas_id, "u": user_id, "r": role})


async def _room(db, creator):
    row = await db.execute(text("""
        INSERT INTO chat_room (room_type, room_name, created_by)
        VALUES ('group', 'R', :u) RETURNING room_id
    """), {"u": creator})
    return row.scalar_one()


async def _room_member(db, room_id, user_id):
    await db.execute(text(
        "INSERT INTO chat_room_member (room_id, user_id) VALUES (:r, :u)"
    ), {"r": room_id, "u": user_id})


# ── 범위 없음 / 비멤버 → 빈 결과 ───────────────────────────────────────────

async def test_no_scope_returns_empty(db_session):
    alice = await _user(db_session, "alice09", "a09@t.local")
    await _user(db_session, "bob09", "b09@t.local")
    res = await chat_controller.search_mentions("bob", _req(alice), db_session)
    assert res["status"] is True
    assert res["users"] == []


async def test_branch_non_member_returns_empty(db_session):
    alice = await _user(db_session, "alice09b", "a09b@t.local")
    bob = await _user(db_session, "bob09b", "b09b@t.local")
    br = await _branch(db_session, bob, "MEN1")
    await _branch_member(db_session, br, bob)  # alice는 멤버 아님
    res = await chat_controller.search_mentions("bob", _req(alice), db_session, branch_id=br)
    assert res["users"] == []


async def test_canvas_non_member_returns_empty(db_session):
    alice = await _user(db_session, "alice09e", "a09e@t.local")
    bob = await _user(db_session, "bob09e", "b09e@t.local")
    br = await _branch(db_session, bob, "MEN4")
    cv = await _canvas(db_session, br, bob, "CMEN4")
    await _canvas_member(db_session, cv, bob)  # alice는 멤버 아님
    res = await chat_controller.search_mentions("bob", _req(alice), db_session, canvas_id=cv)
    assert res["users"] == []


async def test_room_non_member_returns_empty(db_session):
    alice = await _user(db_session, "alice09f", "a09f@t.local")
    bob = await _user(db_session, "bob09f", "b09f@t.local")
    room = await _room(db_session, bob)
    await _room_member(db_session, room, bob)  # alice는 멤버 아님
    res = await chat_controller.search_mentions("bob", _req(alice), db_session, room_id=room)
    assert res["users"] == []


# ── 멤버 → 범위 내 결과, 이메일 제거 ───────────────────────────────────────

async def test_branch_member_gets_scoped_results_without_email(db_session):
    alice = await _user(db_session, "alice09c", "a09c@t.local")
    bob = await _user(db_session, "bob09c", "b09c@t.local")
    br = await _branch(db_session, alice, "MEN2")
    await _branch_member(db_session, br, alice)
    await _branch_member(db_session, br, bob)
    res = await chat_controller.search_mentions("bob", _req(alice), db_session, branch_id=br)
    names = [u["username"] for u in res["users"]]
    assert "bob09c" in names
    assert all("email" not in u for u in res["users"])


async def test_canvas_member_scoping_without_email(db_session):
    alice = await _user(db_session, "alice09d", "a09d@t.local")
    bob = await _user(db_session, "bob09d", "b09d@t.local")
    br = await _branch(db_session, alice, "MEN3")
    cv = await _canvas(db_session, br, alice, "CMEN3")
    await _canvas_member(db_session, cv, alice)
    await _canvas_member(db_session, cv, bob)
    res = await chat_controller.search_mentions("bob", _req(alice), db_session, canvas_id=cv)
    names = [u["username"] for u in res["users"]]
    assert "bob09d" in names
    assert all("email" not in u for u in res["users"])


async def test_room_member_scoping_without_email(db_session):
    alice = await _user(db_session, "alice09g", "a09g@t.local")
    bob = await _user(db_session, "bob09g", "b09g@t.local")
    room = await _room(db_session, alice)
    await _room_member(db_session, room, alice)
    await _room_member(db_session, room, bob)
    res = await chat_controller.search_mentions("bob", _req(alice), db_session, room_id=room)
    names = [u["username"] for u in res["users"]]
    assert "bob09g" in names
    assert all("email" not in u for u in res["users"])


# ── 메신저 디렉터리도 이메일 제거 ─────────────────────────────────────────

async def test_directory_strips_email(db_session):
    await _user(db_session, "dir09", "dir09@t.local")
    res = await chat_controller.get_users(db_session)
    assert res["status"] is True
    assert all("email" not in u for u in res["users"])
    assert any(u["username"] == "dir09" for u in res["users"])
