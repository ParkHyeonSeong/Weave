from types import SimpleNamespace

from sqlalchemy import text

from core.controller import scrum_retro as ctrl
from core.controller import scrum_board as board_ctrl
from routers.schema import scrum_board as schema


def _req(user_id):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def test_get_current_creates_and_returns_for_member(db_session):
    owner = await _make_user(db_session, "rc1@test.local", "rc1")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    out = await ctrl.get_current(bid, _req(owner), db_session)
    assert out["status"] is True
    assert out["retro"] is not None
    assert out["retro"]["board_id"] == bid
    assert out["retro"]["status"] == "open"
    rid = out["retro"]["retro_id"]
    again = await ctrl.get_current(bid, _req(owner), db_session)
    assert again["retro"]["retro_id"] == rid


async def test_get_current_denies_nonmember(db_session):
    owner = await _make_user(db_session, "rc2@test.local", "rc2")
    stranger = await _make_user(db_session, "rc2b@test.local", "rc2b")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    out = await ctrl.get_current(bid, _req(stranger), db_session)
    assert out["status"] is False
    assert out["message"] == "PERMISSION_DENIED"


async def test_get_current_manual_board_returns_none(db_session):
    owner = await _make_user(db_session, "rc3@test.local", "rc3")
    res = await board_ctrl.create(
        schema.ScrumBoardCreate(name="t", retro_cadence="manual"), _req(owner), db_session)
    bid = res["board_id"]
    out = await ctrl.get_current(bid, _req(owner), db_session)
    assert out["status"] is True
    assert out["retro"] is None


async def test_get_current_board_not_found(db_session):
    u = await _make_user(db_session, "rc4@test.local", "rc4")
    out = await ctrl.get_current(99999999, _req(u), db_session)
    assert out["status"] is False
    assert out["message"] == "BOARD_NOT_FOUND"


async def test_list_retros_returns_created_for_member(db_session):
    owner = await _make_user(db_session, "rc5@test.local", "rc5")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    created = await ctrl.get_current(bid, _req(owner), db_session)
    rid = created["retro"]["retro_id"]
    out = await ctrl.list_retros(bid, _req(owner), db_session)
    assert out["status"] is True
    assert any(r["retro_id"] == rid for r in out["retros"])
