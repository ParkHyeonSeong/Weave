from types import SimpleNamespace
from sqlalchemy import text
from core.controller import track as track_ctrl
from core.model import track_member


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
