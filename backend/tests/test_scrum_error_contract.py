"""Prove that the scrum cluster controllers (board / week / retro) and the
scrum_retro router inline site emit the unified error contract after migration:
  res["status"] is False
  res["code"] == "<CODE>"
  res["category"] == "<category>"
  res["message"] == res["code"]   ← dual-emit invariant

One representative test per category present in the cluster:
  - not_found  (BOARD_NOT_FOUND)
  - forbidden  (PERMISSION_DENIED, ACCESS_DENIED, NOT_BOARD_MEMBER)
  - business   (CANNOT_LEAVE_LAST_ADMIN, LAST_ADMIN)
  - validation (INVALID_CELL, INVALID_DATE via router inline)
  + not_found  (RETRO_NOT_FOUND) — second not_found resource type worth covering
  + not_found  (MEMBER_NOT_FOUND) — has no pre-existing test
"""
from datetime import date as date_type
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import scrum_board as board_ctrl
from core.controller import scrum_week as week_ctrl
from core.controller import scrum_retro as retro_ctrl
from core.model import scrum_member as member_model
from routers.schema import scrum_board as schema
from routers.schema.scrum_cell import WeekCellWrite, RetroCellWrite


# ---------------------------------------------------------------------------
# Seed helpers — cribbed verbatim from test_controller_scrum_board.py
# and test_controller_scrum_retro.py
# ---------------------------------------------------------------------------

def _req(user_id: int):
    """controller가 읽는 request.state.payload만 흉내낸다."""
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _board_with_retro(db, owner):
    """Create a weekly board and materialise the current retro for the owner."""
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db)
    bid = res["board_id"]
    cur = await retro_ctrl.get_current(bid, _req(owner), db)   # weekly → retro 자동 생성
    return bid, cur["retro"]["retro_id"]


# ---------------------------------------------------------------------------
# Category: not_found — BOARD_NOT_FOUND
# ---------------------------------------------------------------------------

async def test_board_not_found_carries_contract(db_session):
    """scrum_board.get_detail → BOARD_NOT_FOUND should carry code/category/message."""
    u = await _make_user(db_session, "ec_snf1@test.local", "ec_snf1")
    res = await board_ctrl.get_detail(99999999, _req(u), db_session)
    assert res["status"] is False
    assert res["code"] == "BOARD_NOT_FOUND"
    assert res["category"] == "not_found"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# Category: forbidden — PERMISSION_DENIED
# ---------------------------------------------------------------------------

async def test_permission_denied_carries_contract(db_session):
    """scrum_week._require_member → PERMISSION_DENIED (non-member on private board)."""
    owner = await _make_user(db_session, "ec_spd1@test.local", "ec_spd1")
    stranger = await _make_user(db_session, "ec_spd2@test.local", "ec_spd2")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    out = await week_ctrl.get_week(bid, 2026, 24, _req(stranger), db_session)
    assert out["status"] is False
    assert out["code"] == "PERMISSION_DENIED"
    assert out["category"] == "forbidden"
    assert out["retryable"] is False
    assert out["message"] == out["code"]


# ---------------------------------------------------------------------------
# Category: forbidden — ACCESS_DENIED (private board, non-member visibility)
# ---------------------------------------------------------------------------

async def test_access_denied_carries_contract(db_session):
    """scrum_board.get_detail → ACCESS_DENIED (non-member on private board that exists)."""
    owner = await _make_user(db_session, "ec_sad1@test.local", "ec_sad1")
    stranger = await _make_user(db_session, "ec_sad2@test.local", "ec_sad2")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="비공개"), _req(owner), db_session)
    bid = res["board_id"]
    out = await board_ctrl.get_detail(bid, _req(stranger), db_session)
    assert out["status"] is False
    assert out["code"] == "ACCESS_DENIED"
    assert out["category"] == "forbidden"
    assert out["retryable"] is False
    assert out["message"] == out["code"]


# ---------------------------------------------------------------------------
# Category: forbidden — NOT_BOARD_MEMBER (leave when not a member)
# ---------------------------------------------------------------------------

async def test_not_board_member_carries_contract(db_session):
    """scrum_board.leave → NOT_BOARD_MEMBER when user has no membership row."""
    owner = await _make_user(db_session, "ec_snbm1@test.local", "ec_snbm1")
    stranger = await _make_user(db_session, "ec_snbm2@test.local", "ec_snbm2")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    out = await board_ctrl.leave(bid, _req(stranger), db_session)
    assert out["status"] is False
    assert out["code"] == "NOT_BOARD_MEMBER"
    assert out["category"] == "forbidden"
    assert out["retryable"] is False
    assert out["message"] == out["code"]


# ---------------------------------------------------------------------------
# Category: business — CANNOT_LEAVE_LAST_ADMIN
# ---------------------------------------------------------------------------

async def test_cannot_leave_last_admin_carries_contract(db_session):
    """scrum_board.leave → CANNOT_LEAVE_LAST_ADMIN when sole admin tries to leave."""
    owner = await _make_user(db_session, "ec_sclla1@test.local", "ec_sclla1")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    out = await board_ctrl.leave(bid, _req(owner), db_session)
    assert out["status"] is False
    assert out["code"] == "CANNOT_LEAVE_LAST_ADMIN"
    assert out["category"] == "business"
    assert out["retryable"] is False
    assert out["message"] == out["code"]


# ---------------------------------------------------------------------------
# Category: business — LAST_ADMIN (update_member_role)
# ---------------------------------------------------------------------------

async def test_last_admin_demotion_carries_contract(db_session):
    """scrum_board.update_member_role → LAST_ADMIN when sole admin would be demoted."""
    owner = await _make_user(db_session, "ec_sla1@test.local", "ec_sla1")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    out = await board_ctrl.update_member_role(
        bid, owner, schema.ScrumMemberRoleUpdate(role="member"), _req(owner), db_session)
    assert out["status"] is False
    assert out["code"] == "LAST_ADMIN"
    assert out["category"] == "business"
    assert out["retryable"] is False
    assert out["message"] == out["code"]


# ---------------------------------------------------------------------------
# Category: not_found — MEMBER_NOT_FOUND (update_member_role on absent user)
# ---------------------------------------------------------------------------

async def test_member_not_found_carries_contract(db_session):
    """scrum_board.update_member_role → MEMBER_NOT_FOUND when target has no role."""
    owner = await _make_user(db_session, "ec_smnf1@test.local", "ec_smnf1")
    stranger = await _make_user(db_session, "ec_smnf2@test.local", "ec_smnf2")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    # stranger is not a member — update_member_role should return MEMBER_NOT_FOUND
    out = await board_ctrl.update_member_role(
        bid, stranger, schema.ScrumMemberRoleUpdate(role="member"), _req(owner), db_session)
    assert out["status"] is False
    assert out["code"] == "MEMBER_NOT_FOUND"
    assert out["category"] == "not_found"
    assert out["retryable"] is False
    assert out["message"] == out["code"]


# ---------------------------------------------------------------------------
# Category: validation — INVALID_CELL (scrum_week.write_week_cell)
# ---------------------------------------------------------------------------

async def test_invalid_cell_week_carries_contract(db_session):
    """scrum_week.write_week_cell → INVALID_CELL for unrecognised row name."""
    owner = await _make_user(db_session, "ec_sic1@test.local", "ec_sic1")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    body = WeekCellWrite(day=0, row="nope", text="x")
    out = await week_ctrl.write_week_cell(bid, 2026, 25, body, _req(owner), db_session)
    assert out["status"] is False
    assert out["code"] == "INVALID_CELL"
    assert out["category"] == "validation"
    assert out["retryable"] is False
    assert out["message"] == out["code"]


# ---------------------------------------------------------------------------
# Category: validation — INVALID_DATE (router inline in routers/scrum_retro.py)
# ---------------------------------------------------------------------------

async def test_invalid_date_router_inline_carries_contract(db_session):
    """Exercises the router-inline failure site at routers/scrum_retro.py:31.

    The router function is called directly (bypassing FastAPI routing) to verify
    the INVALID_DATE error_response wrapping after migration.
    """
    from routers import scrum_retro as retro_router

    owner = await _make_user(db_session, "ec_sid1@test.local", "ec_sid1")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]

    # Simulate the router endpoint function directly: pass an invalid date string
    # The router's `get_period` parses the `date` query param itself before calling the controller
    out = await retro_router.get_period(bid, _req(owner), date="not-a-date", session=db_session)
    assert out["status"] is False
    assert out["code"] == "INVALID_DATE"
    assert out["category"] == "validation"
    assert out["retryable"] is False
    assert out["message"] == out["code"]


# ---------------------------------------------------------------------------
# Category: not_found — RETRO_NOT_FOUND (scrum_retro.get_retro_cells)
# ---------------------------------------------------------------------------

async def test_retro_not_found_carries_contract(db_session):
    """scrum_retro.get_retro_cells → RETRO_NOT_FOUND when retro_id belongs to another board."""
    owner = await _make_user(db_session, "ec_srnf1@test.local", "ec_srnf1")
    bid, rid = await _board_with_retro(db_session, owner)
    other_bid, _ = await _board_with_retro(db_session, owner)
    # Use other_bid but the rid that belongs to bid — cross-board mismatch
    out = await retro_ctrl.get_retro_cells(other_bid, rid, _req(owner), db_session)
    assert out["status"] is False
    assert out["code"] == "RETRO_NOT_FOUND"
    assert out["category"] == "not_found"
    assert out["retryable"] is False
    assert out["message"] == out["code"]
