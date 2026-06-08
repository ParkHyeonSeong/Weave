from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import scrum_board as board_model
from core.model import scrum_member as member_model
from core.model import scrum_week as week_model


async def get_week(board_id: int, iso_year: int, iso_week: int,
                   request: Request, db: AsyncSession):
    """주 문서를 보장(get_or_create)하고 메타 반환. 멤버 전용."""
    if not await board_model.find_by_id(board_id, db):
        return {'status': False, 'message': 'BOARD_NOT_FOUND'}
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(board_id, user_id, db):
        return {'status': False, 'message': 'PERMISSION_DENIED'}
    week = await week_model.get_or_create(board_id, iso_year, iso_week, db)
    return {'status': True, 'week': week}
