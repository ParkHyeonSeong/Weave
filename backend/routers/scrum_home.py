from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.controller import scrum_home as home_controller
from library.validator import require_login
from library.rate_limiter import limiter, user_or_ip_key
from config import AGGREGATE_RATE_LIMIT
import db_engine as db

router = APIRouter()


@router.get("/home-cards", summary="홈 조건부 카드", dependencies=[Depends(require_login)])
@limiter.limit(AGGREGATE_RATE_LIMIT, key_func=user_or_ip_key)  # 집계 부하 남용 방지(SEC-11)
async def home_cards(request: Request, session: AsyncSession = Depends(db.session)):
    return await home_controller.home_cards(request, session)
