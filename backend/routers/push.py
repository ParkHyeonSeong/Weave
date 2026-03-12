from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.controller import push as push_controller
from routers.schema.push import SubscribeBody, UnsubscribeBody
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.get("/vapid-key", summary="VAPID 공개키 조회", dependencies=[Depends(require_login)])
async def get_vapid_key():
    return await push_controller.get_vapid_key()


@router.post("/subscribe", summary="Push 구독 등록", dependencies=[Depends(require_login)])
async def subscribe(body: SubscribeBody, request: Request,
                    session: AsyncSession = Depends(db.session)):
    return await push_controller.subscribe(body, request, session)


@router.delete("/unsubscribe", summary="Push 구독 해제", dependencies=[Depends(require_login)])
async def unsubscribe(body: UnsubscribeBody, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await push_controller.unsubscribe(body, request, session)
