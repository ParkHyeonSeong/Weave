from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


_WEEK_COLS = "week_id, board_id, iso_year, iso_week, yjs_updated_at"


async def get_or_create(board_id: int, iso_year: int, iso_week: int,
                        db: AsyncSession) -> dict:
    """(board, iso_year, iso_week)의 주 문서를 보장하고 메타 dict 반환.
    읽기 우선 — 공통 경로(이미 존재)는 인덱스 SELECT 1쿼리. 첫 접근만 INSERT."""
    params = {'board_id': board_id, 'iso_year': iso_year, 'iso_week': iso_week}
    sel = text(f"""
        SELECT {_WEEK_COLS} FROM scrum_week
        WHERE board_id = :board_id AND iso_year = :iso_year AND iso_week = :iso_week
    """)
    row = (await db.execute(sel, params)).fetchone()
    if row:
        return dict(row._mapping)
    # 없으면 생성 (동시 생성 경합은 UNIQUE + ON CONFLICT로 안전)
    await db.execute(text("""
        INSERT INTO scrum_week (board_id, iso_year, iso_week)
        VALUES (:board_id, :iso_year, :iso_week)
        ON CONFLICT (board_id, iso_year, iso_week) DO NOTHING
    """), params)
    row = (await db.execute(sel, params)).fetchone()
    return dict(row._mapping)


async def find_by_id(week_id: int, db: AsyncSession):
    """주 메타 (board 소속 확인용)."""
    result = await db.execute(text(f"""
        SELECT {_WEEK_COLS} FROM scrum_week WHERE week_id = :week_id
    """), {'week_id': week_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def get_yjs_state(week_id: int, db: AsyncSession) -> bytes | None:
    result = await db.execute(text("""
        SELECT yjs_state FROM scrum_week WHERE week_id = :week_id
    """), {'week_id': week_id})
    row = result.fetchone()
    return row[0] if row else None


async def save_yjs_state(week_id: int, yjs_state: bytes, db: AsyncSession):
    await db.execute(text("""
        UPDATE scrum_week
        SET yjs_state = :yjs_state, yjs_updated_at = NOW(), updated_at = NOW()
        WHERE week_id = :week_id
    """), {'week_id': week_id, 'yjs_state': yjs_state})
