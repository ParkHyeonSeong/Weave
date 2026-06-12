"""SEC-21/37: branch/canvas 멤버 목록의 이메일은 멤버에게만 노출.

- 공개 branch/canvas: 비멤버도 목록은 보지만 이메일은 제거
- 멤버: 이메일 포함
- 비공개 branch/canvas: 비멤버는 접근 거부(ACCESS_DENIED)
"""
from types import SimpleNamespace

import bcrypt
from sqlalchemy import text

from core.controller import branch as branch_controller
from core.controller import canvas as canvas_controller


def _req(uid):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': uid}))


async def _user(db, username, email):
    pw = bcrypt.hashpw(b"x", bcrypt.gensalt())
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES (:e, :p, :u, 'active', 'member') RETURNING user_id
    """), {"e": email, "p": pw, "u": username})
    return row.scalar_one()


async def _branch(db, creator, key, visibility):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES ('B', :k, 'd', :v, '#5E6AD2', :u) RETURNING branch_id
    """), {"k": key, "v": visibility, "u": creator})
    return row.scalar_one()


async def _bmember(db, branch_id, user_id):
    await db.execute(text(
        "INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, 'member')"
    ), {"b": branch_id, "u": user_id})


async def _canvas(db, branch_id, creator, key, visibility):
    row = await db.execute(text("""
        INSERT INTO canvas (branch_id, canvas_name, key, visibility, created_by)
        VALUES (:b, 'C', :k, :v, :u) RETURNING canvas_id
    """), {"b": branch_id, "k": key, "v": visibility, "u": creator})
    return row.scalar_one()


async def _cmember(db, canvas_id, user_id):
    await db.execute(text(
        "INSERT INTO canvas_member (canvas_id, user_id, role) VALUES (:c, :u, 'member')"
    ), {"c": canvas_id, "u": user_id})


async def _track(db, creator, key_unused, visibility):
    row = await db.execute(text("""
        INSERT INTO track (track_name, description, color, visibility, default_view, created_by)
        VALUES ('T', 'd', '#5E6AD2', :v, 'flow', :u) RETURNING track_id
    """), {"v": visibility, "u": creator})
    return row.scalar_one()


async def _tmember(db, track_id, user_id):
    await db.execute(text(
        "INSERT INTO track_member (track_id, user_id, role) VALUES (:t, :u, 'member')"
    ), {"t": track_id, "u": user_id})


async def _board(db, creator, visibility):
    row = await db.execute(text("""
        INSERT INTO scrum_board (name, visibility, created_by)
        VALUES ('SB', :v, :u) RETURNING board_id
    """), {"v": visibility, "u": creator})
    return row.scalar_one()


async def _sbmember(db, board_id, user_id):
    await db.execute(text(
        "INSERT INTO scrum_member (board_id, user_id, role) VALUES (:b, :u, 'member')"
    ), {"b": board_id, "u": user_id})


# ── branch (SEC-21) ───────────────────────────────────────────────────────

async def test_public_branch_nonmember_gets_list_without_email(db_session):
    owner = await _user(db_session, "own21a", "own21a@t.local")
    outsider = await _user(db_session, "out21a", "out21a@t.local")
    br = await _branch(db_session, owner, "EM1", "public")
    await _bmember(db_session, br, owner)
    res = await branch_controller.get_members(br, _req(outsider), db_session)
    assert res["status"] is True
    assert len(res["members"]) == 1
    assert all("email" not in m for m in res["members"])


async def test_branch_member_sees_email(db_session):
    owner = await _user(db_session, "own21b", "own21b@t.local")
    br = await _branch(db_session, owner, "EM2", "public")
    await _bmember(db_session, br, owner)
    res = await branch_controller.get_members(br, _req(owner), db_session)
    assert res["status"] is True
    assert any(m.get("email") == "own21b@t.local" for m in res["members"])


async def test_private_branch_nonmember_denied(db_session):
    owner = await _user(db_session, "own21c", "own21c@t.local")
    outsider = await _user(db_session, "out21c", "out21c@t.local")
    br = await _branch(db_session, owner, "EM3", "private")
    await _bmember(db_session, br, owner)
    res = await branch_controller.get_members(br, _req(outsider), db_session)
    assert res["status"] is False
    assert res["message"] == "ACCESS_DENIED"


# ── canvas (SEC-37) ───────────────────────────────────────────────────────

async def test_public_canvas_nonmember_gets_list_without_email(db_session):
    owner = await _user(db_session, "own37a", "own37a@t.local")
    outsider = await _user(db_session, "out37a", "out37a@t.local")
    br = await _branch(db_session, owner, "EM4", "public")
    cv = await _canvas(db_session, br, owner, "CEM4", "public")
    await _cmember(db_session, cv, owner)
    res = await canvas_controller.get_members(cv, _req(outsider), db_session)
    assert res["status"] is True
    assert all("email" not in m for m in res["members"])


async def test_canvas_member_sees_email(db_session):
    owner = await _user(db_session, "own37b", "own37b@t.local")
    br = await _branch(db_session, owner, "EM5", "public")
    cv = await _canvas(db_session, br, owner, "CEM5", "public")
    await _cmember(db_session, cv, owner)
    res = await canvas_controller.get_members(cv, _req(owner), db_session)
    assert res["status"] is True
    assert any(m.get("email") == "own37b@t.local" for m in res["members"])


async def test_private_canvas_nonmember_denied(db_session):
    owner = await _user(db_session, "own37c", "own37c@t.local")
    outsider = await _user(db_session, "out37c", "out37c@t.local")
    br = await _branch(db_session, owner, "EM6", "public")
    cv = await _canvas(db_session, br, owner, "CEM6", "private")
    await _cmember(db_session, cv, owner)
    res = await canvas_controller.get_members(cv, _req(outsider), db_session)
    assert res["status"] is False
    assert res["message"] == "ACCESS_DENIED"


# ── track / scrum board (SEC-21 동류) ─────────────────────────────────────

async def test_public_track_nonmember_no_email(db_session):
    from core.controller import track as track_controller
    owner = await _user(db_session, "ownT1", "ownT1@t.local")
    outsider = await _user(db_session, "outT1", "outT1@t.local")
    tr = await _track(db_session, owner, None, "public")
    await _tmember(db_session, tr, owner)
    res = await track_controller.get_members(tr, _req(outsider), db_session)
    assert res["status"] is True
    assert all("email" not in m for m in res["members"])


async def test_track_member_sees_email(db_session):
    from core.controller import track as track_controller
    owner = await _user(db_session, "ownT2", "ownT2@t.local")
    tr = await _track(db_session, owner, None, "public")
    await _tmember(db_session, tr, owner)
    res = await track_controller.get_members(tr, _req(owner), db_session)
    assert res["status"] is True
    assert any(m.get("email") == "ownT2@t.local" for m in res["members"])


async def test_public_scrum_board_nonmember_no_email(db_session):
    from core.controller import scrum_board as scrum_controller
    owner = await _user(db_session, "ownS1", "ownS1@t.local")
    outsider = await _user(db_session, "outS1", "outS1@t.local")
    bd = await _board(db_session, owner, "public")
    await _sbmember(db_session, bd, owner)
    res = await scrum_controller.get_members(bd, _req(outsider), db_session)
    assert res["status"] is True
    assert all("email" not in m for m in res["members"])


async def test_scrum_board_member_sees_email(db_session):
    from core.controller import scrum_board as scrum_controller
    owner = await _user(db_session, "ownS2", "ownS2@t.local")
    bd = await _board(db_session, owner, "public")
    await _sbmember(db_session, bd, owner)
    res = await scrum_controller.get_members(bd, _req(owner), db_session)
    assert res["status"] is True
    assert any(m.get("email") == "ownS2@t.local" for m in res["members"])
