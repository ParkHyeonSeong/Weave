from types import SimpleNamespace

from sqlalchemy import text

from core.controller import scrum_retro as ctrl
from core.controller import scrum_board as board_ctrl
from routers.schema import scrum_board as schema
from routers.schema.scrum_cell import RetroCellWrite


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


async def test_get_period_current_and_navigation(db_session):
    from datetime import date as d
    owner = await _make_user(db_session, "rp1@test.local", "rp1")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)  # weekly
    bid = res["board_id"]
    cur = await ctrl.get_period(bid, _req(owner), db_session)
    assert cur["status"] is True
    assert cur["retro"] is not None
    assert cur["is_current"] is True
    assert cur["prev_date"] and cur["next_date"]
    # 이전 기간으로 이동 → 다른 회고, 현재 아님
    prev = await ctrl.get_period(bid, _req(owner), db_session, d.fromisoformat(cur["prev_date"]))
    assert prev["retro"]["retro_id"] != cur["retro"]["retro_id"]
    assert prev["is_current"] is False
    # prev의 next로 돌아오면 다시 현재 회고
    back = await ctrl.get_period(bid, _req(owner), db_session, d.fromisoformat(prev["next_date"]))
    assert back["retro"]["retro_id"] == cur["retro"]["retro_id"]
    assert back["is_current"] is True


async def test_get_period_manual_returns_none(db_session):
    owner = await _make_user(db_session, "rp2@test.local", "rp2")
    res = await board_ctrl.create(
        schema.ScrumBoardCreate(name="t", retro_cadence="manual"), _req(owner), db_session)
    out = await ctrl.get_period(res["board_id"], _req(owner), db_session)
    assert out["status"] is True
    assert out["retro"] is None
    assert out["prev_date"] is None and out["next_date"] is None


async def test_get_period_denies_nonmember(db_session):
    owner = await _make_user(db_session, "rp3@test.local", "rp3")
    stranger = await _make_user(db_session, "rp3b@test.local", "rp3b")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    out = await ctrl.get_period(res["board_id"], _req(stranger), db_session)
    assert out["status"] is False
    assert out["message"] == "PERMISSION_DENIED"


async def _board_with_retro(db, owner):
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db)
    bid = res["board_id"]
    cur = await ctrl.get_current(bid, _req(owner), db)   # weekly → retro 자동 생성
    return bid, cur["retro"]["retro_id"]


async def test_write_and_read_retro_cell_roundtrip(db_session):
    owner = await _make_user(db_session, "rcell1@test.local", "rcell1")
    bid, rid = await _board_with_retro(db_session, owner)
    body = RetroCellWrite(key="keep", text="페어 리뷰 좋았음", mode="replace")
    w = await ctrl.write_retro_cell(bid, rid, body, _req(owner), db_session)
    assert w["status"] is True
    out = await ctrl.get_retro_cells(bid, rid, _req(owner), db_session)
    assert out["cells"][f"{owner}:keep"] == "페어 리뷰 좋았음"


async def test_write_retro_cell_denies_nonmember(db_session):
    owner = await _make_user(db_session, "rcell2@test.local", "rcell2")
    stranger = await _make_user(db_session, "rcell2b@test.local", "rcell2b")
    bid, rid = await _board_with_retro(db_session, owner)
    body = RetroCellWrite(key="try", text="x")
    out = await ctrl.write_retro_cell(bid, rid, body, _req(stranger), db_session)
    assert out["status"] is False
    assert out["message"] == "PERMISSION_DENIED"


async def test_write_retro_cell_invalid_key(db_session):
    owner = await _make_user(db_session, "rcell3@test.local", "rcell3")
    bid, rid = await _board_with_retro(db_session, owner)
    body = RetroCellWrite(key="nope", text="x")
    out = await ctrl.write_retro_cell(bid, rid, body, _req(owner), db_session)
    assert out["status"] is False
    assert out["message"] == "INVALID_CELL"


async def test_retro_cell_wrong_board(db_session):
    owner = await _make_user(db_session, "rcell4@test.local", "rcell4")
    bid, rid = await _board_with_retro(db_session, owner)
    other_bid, _ = await _board_with_retro(db_session, owner)
    out = await ctrl.get_retro_cells(other_bid, rid, _req(owner), db_session)
    assert out["status"] is False
    assert out["message"] == "RETRO_NOT_FOUND"
