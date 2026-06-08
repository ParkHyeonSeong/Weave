from sqlalchemy import text

from core.model import scrum_board as board_model
from core.model import scrum_member as member_model


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_board(db, uid):
    return await board_model.create(
        name="b", icon=None, color="#16A34A", visibility="private",
        retro_cadence="weekly", retro_interval_weeks=None, retro_template="kpt",
        retro_anchor_weekday=4, created_by=uid, db=db)


async def test_add_and_get_role(db_session):
    uid = await _make_user(db_session, "m1@test.local", "m1")
    bid = await _make_board(db_session, uid)
    await member_model.add(bid, uid, "admin", db_session)
    assert await member_model.get_role(bid, uid, db_session) == "admin"
    assert await member_model.is_member(bid, uid, db_session) is True


async def test_get_role_none_for_nonmember(db_session):
    uid = await _make_user(db_session, "m2@test.local", "m2")
    other = await _make_user(db_session, "m2b@test.local", "m2b")
    bid = await _make_board(db_session, uid)
    assert await member_model.get_role(bid, other, db_session) is None
    assert await member_model.is_member(bid, other, db_session) is False


async def test_find_by_board_includes_username(db_session):
    uid = await _make_user(db_session, "m3@test.local", "alice")
    bid = await _make_board(db_session, uid)
    await member_model.add(bid, uid, "admin", db_session)
    rows = await member_model.find_by_board(bid, db_session)
    assert len(rows) == 1
    assert rows[0]["username"] == "alice"
    assert rows[0]["role"] == "admin"


async def test_update_role_and_remove(db_session):
    uid = await _make_user(db_session, "m4@test.local", "m4")
    bid = await _make_board(db_session, uid)
    await member_model.add(bid, uid, "member", db_session)
    await member_model.update_role(bid, uid, "admin", db_session)
    assert await member_model.get_role(bid, uid, db_session) == "admin"
    await member_model.remove(bid, uid, db_session)
    assert await member_model.is_member(bid, uid, db_session) is False


async def test_count_admins(db_session):
    a = await _make_user(db_session, "m5a@test.local", "m5a")
    b = await _make_user(db_session, "m5b@test.local", "m5b")
    bid = await _make_board(db_session, a)
    await member_model.add(bid, a, "admin", db_session)
    await member_model.add(bid, b, "member", db_session)
    assert await member_model.count_admins(bid, db_session) == 1


def test_has_at_least():
    assert member_model.has_at_least("admin", "member") is True
    assert member_model.has_at_least("admin", "admin") is True
    assert member_model.has_at_least("member", "admin") is False
    assert member_model.has_at_least(None, "member") is False
