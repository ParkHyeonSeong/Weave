from datetime import date

from pycrdt import Doc, XmlElement, XmlFragment, XmlText
from sqlalchemy import text

from core.controller import scrum_board as board_ctrl
from core.controller import scrum_home as home
from core.model import scrum_week as week_model
from routers.schema import scrum_board as schema

WED = date(2026, 6, 10)   # 수요일 (weekday 2)
FRI = date(2026, 6, 12)   # 금요일 (weekday 4) — weekly anchor=4 → 회고 due
MON = date(2026, 6, 8)    # 월요일 (weekday 0) — 회고 미due


def _req(user_id):
    from types import SimpleNamespace
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


def _bids(cards):
    return {c['board_id'] for c in cards}


def _written_plan_update(fragment_key: str) -> bytes:
    """fragment_key 셀에 <paragraph>done</paragraph> 를 쓴 doc 업데이트."""
    doc = Doc()
    with doc.transaction():
        frag = doc.get(fragment_key, type=XmlFragment)
        para = XmlElement("paragraph")
        frag.children.append(para)
        para.children.append(XmlText("done"))
    return doc.get_update()


async def test_empty_board_in_today_pending(db_session):
    owner = await _make_user(db_session, "sh1@test.local", "sh1")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="b"), _req(owner), db_session)
    bid = res["board_id"]

    out = await home.collect_cards(owner, WED, db_session)
    assert out["status"] is True
    assert bid in _bids(out["today_pending"])


async def test_written_cell_drops_from_today_pending(db_session):
    owner = await _make_user(db_session, "sh2@test.local", "sh2")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="b"), _req(owner), db_session)
    bid = res["board_id"]

    # WED=weekday 2 → 사용자의 {uid}:2:plan 셀에 내용 작성.
    iso_year, iso_week, _ = WED.isocalendar()
    wid = await week_model.get_or_create(bid, iso_year, iso_week, db_session)
    update = _written_plan_update(f"{owner}:2:plan")
    await week_model.save_yjs_state(wid["week_id"], update, db_session)

    out = await home.collect_cards(owner, WED, db_session)
    assert bid not in _bids(out["today_pending"])


async def test_retro_due_on_anchor_weekday(db_session):
    # 기본 보드: weekly, anchor=4(금) → 금요일이면 retro_due.
    owner = await _make_user(db_session, "sh3@test.local", "sh3")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="b"), _req(owner), db_session)
    bid = res["board_id"]

    fri = await home.collect_cards(owner, FRI, db_session)
    assert bid in _bids(fri["retro_due"])

    mon = await home.collect_cards(owner, MON, db_session)
    assert bid not in _bids(mon["retro_due"])


async def test_nonmember_board_never_appears(db_session):
    owner = await _make_user(db_session, "sh4@test.local", "sh4")
    stranger = await _make_user(db_session, "sh4b@test.local", "sh4b")
    res = await board_ctrl.create(schema.ScrumBoardCreate(name="b"), _req(owner), db_session)
    bid = res["board_id"]

    # stranger는 멤버가 아니므로 어느 카드에도 등장하지 않음.
    out = await home.collect_cards(stranger, FRI, db_session)
    assert bid not in _bids(out["today_pending"])
    assert bid not in _bids(out["retro_due"])


async def test_monthly_retro_due_window(db_session):
    # monthly 보드: 월 마지막 7일(6/24~6/30) 안에서만 retro_due.
    owner = await _make_user(db_session, "sh6@test.local", "sh6")
    res = await board_ctrl.create(
        schema.ScrumBoardCreate(name="b", retro_cadence="monthly"), _req(owner), db_session)
    bid = res["board_id"]

    first = await home.collect_cards(owner, date(2026, 6, 1), db_session)
    assert bid not in _bids(first["retro_due"])  # 1일 → 아직 아님

    late = await home.collect_cards(owner, date(2026, 6, 28), db_session)
    assert bid in _bids(late["retro_due"])  # 마지막 7일 창 안


async def test_weekend_today_pending_empty(db_session):
    # 토요일(weekday 5) → today_pending 빈 목록.
    owner = await _make_user(db_session, "sh5@test.local", "sh5")
    await board_ctrl.create(schema.ScrumBoardCreate(name="b"), _req(owner), db_session)
    sat = date(2026, 6, 13)
    out = await home.collect_cards(owner, sat, db_session)
    assert out["today_pending"] == []
