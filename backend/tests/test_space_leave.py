from types import SimpleNamespace
from sqlalchemy import text
from core.controller import track as track_ctrl
from core.controller import scrum_board as scrum_ctrl
from core.model import track_member
from core.model import scrum_member


def _req(user_id):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


async def _make_user(db, email, name):
    row = await db.execute(text(
        'INSERT INTO "user" (email, password, username, status) '
        "VALUES (:e, :p, :u, 'active') RETURNING user_id"
    ), {"e": email, "p": b"x", "u": name})
    return row.scalar_one()


async def _make_track(db, owner):
    row = await db.execute(text(
        "INSERT INTO track (track_name, visibility, created_by) "
        "VALUES ('T', 'private', :u) RETURNING track_id"
    ), {"u": owner})
    return row.scalar_one()


async def test_track_leave_removes_member(db_session):
    owner = await _make_user(db_session, "to@t.local", "to")
    mate = await _make_user(db_session, "tm@t.local", "tm")
    tid = await _make_track(db_session, owner)
    await track_member.add(tid, owner, "owner", db_session)
    await track_member.add(tid, mate, "editor", db_session)

    res = await track_ctrl.leave(tid, _req(mate), db_session)
    assert res["status"] is True
    assert await track_member.get_role(tid, mate, db_session) is None


async def test_track_leave_non_member_rejected(db_session):
    owner = await _make_user(db_session, "to2@t.local", "to2")
    stranger = await _make_user(db_session, "ts@t.local", "ts")
    tid = await _make_track(db_session, owner)
    await track_member.add(tid, owner, "owner", db_session)

    res = await track_ctrl.leave(tid, _req(stranger), db_session)
    assert res["status"] is False
    assert res["message"] == "NOT_TRACK_MEMBER"


async def test_track_leave_last_owner_blocked(db_session):
    owner = await _make_user(db_session, "to3@t.local", "to3")
    tid = await _make_track(db_session, owner)
    await track_member.add(tid, owner, "owner", db_session)

    res = await track_ctrl.leave(tid, _req(owner), db_session)
    assert res["status"] is False
    assert res["message"] == "CANNOT_LEAVE_LAST_OWNER"


async def test_track_leave_owner_with_other_owner_succeeds(db_session):
    # 마지막 owner가 아니면(다른 owner 존재) owner도 나갈 수 있어야 함
    o1 = await _make_user(db_session, "to4a@t.local", "to4a")
    o2 = await _make_user(db_session, "to4b@t.local", "to4b")
    tid = await _make_track(db_session, o1)
    await track_member.add(tid, o1, "owner", db_session)
    await track_member.add(tid, o2, "owner", db_session)

    res = await track_ctrl.leave(tid, _req(o1), db_session)
    assert res["status"] is True
    assert await track_member.get_role(tid, o1, db_session) is None
    assert await track_member.count_owners(tid, db_session) == 1


async def _make_board(db, admin):
    row = await db.execute(text(
        "INSERT INTO scrum_board (name, visibility, created_by) "
        "VALUES ('B', 'private', :u) RETURNING board_id"
    ), {"u": admin})
    return row.scalar_one()


async def test_scrum_leave_removes_member(db_session):
    admin = await _make_user(db_session, "so@s.local", "so")
    mate = await _make_user(db_session, "sm@s.local", "sm")
    bid = await _make_board(db_session, admin)
    await scrum_member.add(bid, admin, "admin", db_session)
    await scrum_member.add(bid, mate, "member", db_session)

    res = await scrum_ctrl.leave(bid, _req(mate), db_session)
    assert res["status"] is True
    assert await scrum_member.get_role(bid, mate, db_session) is None


async def test_scrum_leave_non_member_rejected(db_session):
    admin = await _make_user(db_session, "so2@s.local", "so2")
    stranger = await _make_user(db_session, "ss@s.local", "ss")
    bid = await _make_board(db_session, admin)
    await scrum_member.add(bid, admin, "admin", db_session)

    res = await scrum_ctrl.leave(bid, _req(stranger), db_session)
    assert res["status"] is False
    assert res["message"] == "NOT_BOARD_MEMBER"


async def test_scrum_leave_last_admin_blocked(db_session):
    admin = await _make_user(db_session, "so3@s.local", "so3")
    bid = await _make_board(db_session, admin)
    await scrum_member.add(bid, admin, "admin", db_session)

    res = await scrum_ctrl.leave(bid, _req(admin), db_session)
    assert res["status"] is False
    assert res["message"] == "CANNOT_LEAVE_LAST_ADMIN"


async def test_scrum_leave_admin_with_other_admin_succeeds(db_session):
    a1 = await _make_user(db_session, "so4a@s.local", "so4a")
    a2 = await _make_user(db_session, "so4b@s.local", "so4b")
    bid = await _make_board(db_session, a1)
    await scrum_member.add(bid, a1, "admin", db_session)
    await scrum_member.add(bid, a2, "admin", db_session)

    res = await scrum_ctrl.leave(bid, _req(a1), db_session)
    assert res["status"] is True
    assert await scrum_member.get_role(bid, a1, db_session) is None
