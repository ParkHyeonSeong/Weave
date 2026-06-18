from datetime import date

from sqlalchemy import text
from core.model import scrum_board as board_model
from core.model import scrum_retro as retro_model


async def _user(db, e, u):
    r = await db.execute(text('INSERT INTO "user" (email,password,username,status) VALUES (:e,:p,:u,\'active\') RETURNING user_id'), {"e": e, "p": b"x", "u": u})
    return r.scalar_one()

async def _board(db, uid, cadence='weekly', interval=None, anchor=4):
    return await board_model.create(name="b", icon=None, color="#16A34A", visibility="private",
        retro_cadence=cadence, retro_interval_weeks=interval, retro_template="kpt",
        retro_anchor_weekday=anchor, created_by=uid, db=db)


def test_compute_period_weekly():
    # 2026-06-10(수)가 속한 주: 월 6/8 ~ 금(anchor=4) 6/12
    s, e = retro_model.compute_period('weekly', None, 4, date(2026, 6, 10))
    assert s == date(2026, 6, 8)
    assert e == date(2026, 6, 12)

def test_compute_period_monthly():
    s, e = retro_model.compute_period('monthly', None, 4, date(2026, 6, 10))
    assert s == date(2026, 6, 1)
    assert e == date(2026, 6, 30)

def test_compute_period_biweekly_groups_two_weeks():
    # 에포크 기준 같은 2주 그룹에 드는 연속 두 주(6/17·6/24)는 동일 기간이어야 한다.
    p1 = retro_model.compute_period('biweekly', None, 4, date(2026, 6, 17))
    p2 = retro_model.compute_period('biweekly', None, 4, date(2026, 6, 24))  # 다음 주
    # 같은 2주 그룹이면 동일 기간
    assert p1 == p2
    assert (p1[1] - p1[0]).days == 11  # 2주(월~다음주 금)

def test_compute_period_monthly_december_rollover():
    s, e = retro_model.compute_period('monthly', None, 4, date(2026, 12, 15))
    assert (s, e) == (date(2026, 12, 1), date(2026, 12, 31))

def test_compute_period_every_n_weeks():
    # interval_weeks=None → 기본 2주(=biweekly와 동일)
    assert retro_model.compute_period('every_n_weeks', None, 4, date(2026, 6, 10)) \
        == retro_model.compute_period('biweekly', None, 4, date(2026, 6, 10))
    # 3주 그룹: 월~(3번째 주 금) = 18일 span
    s, e = retro_model.compute_period('every_n_weeks', 3, 4, date(2026, 6, 10))
    assert (e - s).days == 18

def test_compute_period_manual_is_none():
    assert retro_model.compute_period('manual', None, 4, date(2026, 6, 10)) is None


def test_neighbor_anchors_weekly():
    # 현재 주(6/8~)에서 직전은 6/1 주, 직후는 6/15 주.
    prev, nxt = retro_model.neighbor_anchors('weekly', None, 4, date(2026, 6, 10))
    assert retro_model.compute_period('weekly', None, 4, prev)[0] == date(2026, 6, 1)
    assert retro_model.compute_period('weekly', None, 4, nxt)[0] == date(2026, 6, 15)

def test_neighbor_anchors_next_skips_weekend_gap():
    # anchor=금(4): period_end=금. 토(6/13)는 여전히 같은 기간이므로 단순 +1일은 오답 →
    # next 앵커는 반드시 '다른' 기간이어야 한다.
    assert retro_model.compute_period('weekly', None, 4, date(2026, 6, 13))[0] == date(2026, 6, 8)
    _, nxt = retro_model.neighbor_anchors('weekly', None, 4, date(2026, 6, 10))
    assert retro_model.compute_period('weekly', None, 4, nxt)[0] != date(2026, 6, 8)

def test_neighbor_anchors_monthly():
    prev, nxt = retro_model.neighbor_anchors('monthly', None, 4, date(2026, 6, 10))
    assert retro_model.compute_period('monthly', None, 4, prev)[0] == date(2026, 5, 1)
    assert retro_model.compute_period('monthly', None, 4, nxt)[0] == date(2026, 7, 1)

def test_neighbor_anchors_biweekly_roundtrip():
    # next로 갔다가 그 기간의 prev로 오면 원래 기간으로 돌아와야 한다(왕복 안정성).
    base = retro_model.compute_period('biweekly', None, 4, date(2026, 6, 10))
    _, nxt = retro_model.neighbor_anchors('biweekly', None, 4, date(2026, 6, 10))
    prev_back, _ = retro_model.neighbor_anchors('biweekly', None, 4, nxt)
    assert retro_model.compute_period('biweekly', None, 4, prev_back) == base

def test_neighbor_anchors_manual_none():
    assert retro_model.neighbor_anchors('manual', None, 4, date(2026, 6, 10)) == (None, None)


async def test_get_or_create_for_date(db_session):
    uid = await _user(db_session, "rfd@t.l", "rfd")
    bid = await _board(db_session, uid)
    r = await retro_model.get_or_create_for_date(bid, 'weekly', None, 4, date(2026, 5, 20), db_session)
    assert r['period_start'].isoformat() == '2026-05-18'   # 그 주 월요일
    # 같은 기간 안 다른 날짜 → 같은 행(idempotent)
    r2 = await retro_model.get_or_create_for_date(bid, 'weekly', None, 4, date(2026, 5, 22), db_session)
    assert r2['retro_id'] == r['retro_id']

async def test_get_or_create_for_date_manual_none(db_session):
    uid = await _user(db_session, "rfd2@t.l", "rfd2")
    bid = await _board(db_session, uid, cadence='manual')
    assert await retro_model.get_or_create_for_date(bid, 'manual', None, 4, date(2026, 5, 20), db_session) is None


async def test_get_or_create_current_idempotent(db_session):
    uid = await _user(db_session, "r1@t.l", "r1")
    bid = await _board(db_session, uid)
    a = await retro_model.get_or_create_current(bid, 'weekly', None, 4, date(2026, 6, 10), db_session)
    b = await retro_model.get_or_create_current(bid, 'weekly', None, 4, date(2026, 6, 10), db_session)
    assert a['retro_id'] == b['retro_id']
    assert a['period_start'].isoformat() == '2026-06-08'
    assert a['status'] == 'open'

async def test_get_or_create_current_manual_returns_none(db_session):
    uid = await _user(db_session, "r2@t.l", "r2")
    bid = await _board(db_session, uid, cadence='manual')
    assert await retro_model.get_or_create_current(bid, 'manual', None, 4, date(2026, 6, 10), db_session) is None

async def test_yjs_roundtrip_and_list(db_session):
    uid = await _user(db_session, "r3@t.l", "r3")
    bid = await _board(db_session, uid)
    r = await retro_model.get_or_create_current(bid, 'weekly', None, 4, date(2026, 6, 10), db_session)
    rid = r['retro_id']
    assert await retro_model.get_yjs_state(rid, db_session) is None
    await retro_model.save_yjs_state(rid, b"\x09", db_session)
    assert await retro_model.get_yjs_state(rid, db_session) == b"\x09"
    lst = await retro_model.list_by_board(bid, db_session)
    assert any(x['retro_id'] == rid for x in lst)
    found = await retro_model.find_by_id(rid, db_session)
    assert found['board_id'] == bid
