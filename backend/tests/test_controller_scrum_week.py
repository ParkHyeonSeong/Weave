from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy import text

from core.controller import scrum_week as ctrl
from core.controller import scrum_board as board_ctrl
from routers.schema import scrum_board as schema
from routers.schema.scrum_cell import WeekCellWrite


def _req(user_id):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def member_ctrl_add(db, board_id, user_id, role="member"):
    from core.model import scrum_member as member_model
    await member_model.add(board_id, user_id, role, db)


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


async def test_write_and_read_own_cell_roundtrip(db_session):
    owner = await _make_user(db_session, "wcell1@test.local", "wcell1")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    body = WeekCellWrite(day=0, row="plan", text="로그인 수정", mode="replace")
    w = await ctrl.write_week_cell(bid, 2026, 25, body, _req(owner), db_session)
    assert w["status"] is True
    out = await ctrl.get_week_cells(bid, 2026, 25, _req(owner), db_session)
    assert out["status"] is True
    assert out["cells"][f"{owner}:0:plan"] == "로그인 수정"


async def test_write_forces_own_user_id(db_session):
    # body에 다른 user_id를 못 넣음 — 키는 항상 토큰 주체로 생성됨
    owner = await _make_user(db_session, "wcell2@test.local", "wcell2")
    other = await _make_user(db_session, "wcell2b@test.local", "wcell2b")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    await member_ctrl_add(db_session, bid, other)  # other를 멤버로
    body = WeekCellWrite(day=1, row="gap", text="내 메모")
    await ctrl.write_week_cell(bid, 2026, 25, body, _req(owner), db_session)
    out = await ctrl.get_week_cells(bid, 2026, 25, _req(owner), db_session)
    assert out["cells"][f"{owner}:1:gap"] == "내 메모"
    assert out["cells"][f"{other}:1:gap"] == ""


async def test_write_cell_denies_nonmember(db_session):
    owner = await _make_user(db_session, "wcell3@test.local", "wcell3")
    stranger = await _make_user(db_session, "wcell3b@test.local", "wcell3b")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    body = WeekCellWrite(day=0, row="plan", text="x")
    out = await ctrl.write_week_cell(bid, 2026, 25, body, _req(stranger), db_session)
    assert out["status"] is False
    assert out["message"] == "PERMISSION_DENIED"


async def test_write_cell_invalid_row(db_session):
    owner = await _make_user(db_session, "wcell4@test.local", "wcell4")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    body = WeekCellWrite(day=0, row="nope", text="x")
    out = await ctrl.write_week_cell(bid, 2026, 25, body, _req(owner), db_session)
    assert out["status"] is False
    assert out["message"] == "INVALID_CELL"


def test_cell_text_length_cap_rejected():
    # 거대한 셀 텍스트는 스키마 단에서 422(ValidationError)로 차단 — DoS 방지
    from routers.schema.scrum_cell import MAX_CELL_LENGTH
    WeekCellWrite(day=0, row="plan", text="x" * MAX_CELL_LENGTH)  # 경계 OK
    with pytest.raises(ValidationError):
        WeekCellWrite(day=0, row="plan", text="x" * (MAX_CELL_LENGTH + 1))
