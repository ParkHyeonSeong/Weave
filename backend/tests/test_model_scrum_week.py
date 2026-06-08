from sqlalchemy import text

from core.model import scrum_board as board_model
from core.model import scrum_week as week_model


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


async def test_get_or_create_is_idempotent(db_session):
    uid = await _make_user(db_session, "w1@test.local", "w1")
    bid = await _make_board(db_session, uid)
    w1 = await week_model.get_or_create(bid, 2026, 24, db_session)
    w2 = await week_model.get_or_create(bid, 2026, 24, db_session)
    assert isinstance(w1["week_id"], int)
    assert w1["week_id"] == w2["week_id"]
    assert w1["board_id"] == bid and w1["iso_year"] == 2026 and w1["iso_week"] == 24
    w_other = await week_model.get_or_create(bid, 2026, 25, db_session)
    assert w_other["week_id"] != w1["week_id"]


async def test_find_by_id(db_session):
    uid = await _make_user(db_session, "w2@test.local", "w2")
    bid = await _make_board(db_session, uid)
    w = await week_model.get_or_create(bid, 2026, 10, db_session)
    found = await week_model.find_by_id(w["week_id"], db_session)
    assert found["board_id"] == bid
    assert found["iso_year"] == 2026
    assert found["iso_week"] == 10
    assert await week_model.find_by_id(99999999, db_session) is None


async def test_yjs_state_roundtrip(db_session):
    uid = await _make_user(db_session, "w3@test.local", "w3")
    bid = await _make_board(db_session, uid)
    w = await week_model.get_or_create(bid, 2026, 1, db_session)
    wid = w["week_id"]
    assert await week_model.get_yjs_state(wid, db_session) is None
    await week_model.save_yjs_state(wid, b"\x01\x02\x03", db_session)
    assert await week_model.get_yjs_state(wid, db_session) == b"\x01\x02\x03"
