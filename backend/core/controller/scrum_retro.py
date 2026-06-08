from datetime import date, datetime, timezone, timedelta

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import scrum_board as board_model
from core.model import scrum_member as member_model
from core.model import scrum_retro as retro_model

KST = timezone(timedelta(hours=9))


def _today_kst() -> date:
    return datetime.now(KST).date()


async def _require_member(board_id: int, request: Request, db: AsyncSession):
    board = await board_model.find_by_id(board_id, db)
    if not board:
        return None, {'status': False, 'message': 'BOARD_NOT_FOUND'}
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(board_id, user_id, db):
        return None, {'status': False, 'message': 'PERMISSION_DENIED'}
    return board, None


async def get_current(board_id: int, request: Request, db: AsyncSession):
    """현재 기간 회고 보장/반환. manual이면 retro=None(목록에서 수동 생성)."""
    board, err = await _require_member(board_id, request, db)
    if err:
        return err
    retro = await retro_model.get_or_create_current(
        board_id, board['retro_cadence'], board['retro_interval_weeks'],
        board['retro_anchor_weekday'], _today_kst(), db)
    return {'status': True, 'retro': retro}


async def list_retros(board_id: int, request: Request, db: AsyncSession):
    board, err = await _require_member(board_id, request, db)
    if err:
        return err
    return {'status': True, 'retros': await retro_model.list_by_board(board_id, db)}
