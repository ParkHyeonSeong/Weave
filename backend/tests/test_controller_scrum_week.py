from types import SimpleNamespace

from sqlalchemy import text

from core.controller import scrum_week as ctrl
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


async def test_get_week_creates_and_returns_for_member(db_session):
    owner = await _make_user(db_session, "wc1@test.local", "wc1")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    out = await ctrl.get_week(bid, 2026, 24, _req(owner), db_session)
    assert out["status"] is True
    assert out["week"]["board_id"] == bid
    assert out["week"]["iso_year"] == 2026
    assert out["week"]["iso_week"] == 24
    wid = out["week"]["week_id"]
    again = await ctrl.get_week(bid, 2026, 24, _req(owner), db_session)
    assert again["week"]["week_id"] == wid


async def test_get_week_denies_nonmember(db_session):
    owner = await _make_user(db_session, "wc2@test.local", "wc2")
    stranger = await _make_user(db_session, "wc2b@test.local", "wc2b")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    out = await ctrl.get_week(bid, 2026, 24, _req(stranger), db_session)
    assert out["status"] is False
    assert out["message"] == "PERMISSION_DENIED"


async def test_get_week_board_not_found(db_session):
    u = await _make_user(db_session, "wc3@test.local", "wc3")
    out = await ctrl.get_week(99999999, 2026, 24, _req(u), db_session)
    assert out["status"] is False
    assert out["message"] == "BOARD_NOT_FOUND"


async def test_get_week_on_archived_board_is_not_found(db_session):
    # 아카이브된 보드는 find_by_id가 제외 → 주 접근도 BOARD_NOT_FOUND
    owner = await _make_user(db_session, "wc4@test.local", "wc4")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    await board_ctrl.delete(bid, _req(owner), db_session)  # archive
    out = await ctrl.get_week(bid, 2026, 24, _req(owner), db_session)
    assert out["status"] is False
    assert out["message"] == "BOARD_NOT_FOUND"
