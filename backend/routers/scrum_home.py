from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.controller import scrum_home as home_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.get("/home-cards", summary="홈 조건부 카드", dependencies=[Depends(require_login)])
async def home_cards(request: Request, session: AsyncSession = Depends(db.session)):
    return await home_controller.home_cards(request, session)
