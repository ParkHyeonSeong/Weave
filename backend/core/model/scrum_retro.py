from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_EPOCH_MONDAY = date(2000, 1, 3)  # 알려진 월요일 기준점 (주 그룹 정렬용)
_COLS = "retro_id, board_id, period_start, period_end, template, status, yjs_updated_at"


def _monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())  # weekday(): Mon=0


def compute_period(cadence: str, interval_weeks, anchor_weekday: int, today: date):
    """today가 속한 회고 기간 (period_start, period_end). manual이면 None."""
    if cadence == 'manual':
        return None
    if cadence == 'monthly':
        start = today.replace(day=1)
        nxt = start.replace(year=start.year + 1, month=1) if start.month == 12 \
            else start.replace(month=start.month + 1)
        return start, nxt - timedelta(days=1)
    n = 1 if cadence == 'weekly' else (2 if cadence == 'biweekly'
                                       else max(2, int(interval_weeks or 2)))
    monday = _monday_of(today)
    weeks_since = (monday - _EPOCH_MONDAY).days // 7
    group_first = (weeks_since // n) * n
    start = _EPOCH_MONDAY + timedelta(weeks=group_first)
    last_monday = start + timedelta(weeks=n - 1)
    return start, last_monday + timedelta(days=anchor_weekday)


async def get_or_create_current(board_id: int, cadence: str, interval_weeks,
                                anchor_weekday: int, today: date, db: AsyncSession):
    """현재 기간 회고를 보장하고 dict 반환. manual이면 None(자동 생성 안 함)."""
    period = compute_period(cadence, interval_weeks, anchor_weekday, today)
    if period is None:
        return None
    start, end = period
    sel = text(f"SELECT {_COLS} FROM scrum_retro WHERE board_id=:b AND period_start=:s")
    p = {'b': board_id, 's': start}
    row = (await db.execute(sel, p)).fetchone()
    if row:
        return dict(row._mapping)
    await db.execute(text("""
        INSERT INTO scrum_retro (board_id, period_start, period_end, template, status)
        VALUES (:b, :s, :e, 'kpt', 'open')
        ON CONFLICT (board_id, period_start) DO NOTHING
    """), {'b': board_id, 's': start, 'e': end})
    row = (await db.execute(sel, p)).fetchone()
    return dict(row._mapping)


async def find_by_period(board_id: int, period_start: date, db: AsyncSession) -> dict | None:
    """(board, period_start)의 회고 메타 dict 반환. 없으면 None."""
    row = (await db.execute(text(
        "SELECT retro_id, status FROM scrum_retro WHERE board_id=:b AND period_start=:s"),
        {'b': board_id, 's': period_start})).fetchone()
    return dict(row._mapping) if row else None


async def find_by_id(retro_id: int, db: AsyncSession):
    row = (await db.execute(text(f"SELECT {_COLS} FROM scrum_retro WHERE retro_id=:r"),
                            {'r': retro_id})).fetchone()
    return dict(row._mapping) if row else None


async def list_by_board(board_id: int, db: AsyncSession):
    res = await db.execute(text(f"""
        SELECT {_COLS} FROM scrum_retro WHERE board_id=:b ORDER BY period_start DESC
    """), {'b': board_id})
    return [dict(r._mapping) for r in res.fetchall()]


async def get_yjs_state(retro_id: int, db: AsyncSession) -> bytes | None:
    row = (await db.execute(text("SELECT yjs_state FROM scrum_retro WHERE retro_id=:r"),
                            {'r': retro_id})).fetchone()
    return row[0] if row else None


async def save_yjs_state(retro_id: int, yjs_state: bytes, db: AsyncSession):
    await db.execute(text("""
        UPDATE scrum_retro SET yjs_state=:y, yjs_updated_at=NOW(), updated_at=NOW()
        WHERE retro_id=:r
    """), {'r': retro_id, 'y': yjs_state})
