from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.controller import scrum_week as week_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.get("/{board_id}/weeks/{iso_year}/{iso_week}",
            summary="주 문서 조회/생성", dependencies=[Depends(require_login)])
async def get_week(board_id: int, iso_year: int, iso_week: int, request: Request,
                   session: AsyncSession = Depends(db.session)):
    return await week_controller.get_week(board_id, iso_year, iso_week, request, session)
