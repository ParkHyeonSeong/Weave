from fastapi import APIRouter, Request, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from core.controller import notification as noti_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.get("", summary="알림 목록", dependencies=[Depends(require_login)])
async def get_notifications(request: Request,
                            limit: int = Query(30, ge=1, le=100),
                            offset: int = Query(0, ge=0),
                            session: AsyncSession = Depends(db.session)):
    return await noti_controller.get_list(limit, offset, request, session)


@router.get("/unread-count", summary="읽지 않은 알림 수", dependencies=[Depends(require_login)])
async def get_unread_count(request: Request, session: AsyncSession = Depends(db.session)):
    return await noti_controller.get_unread_count(request, session)


@router.patch("/{notification_id}/read", summary="알림 읽음", dependencies=[Depends(require_login)])
async def mark_read(notification_id: int, request: Request,
                    session: AsyncSession = Depends(db.session)):
    return await noti_controller.mark_read(notification_id, request, session)


@router.patch("/read-all", summary="전체 읽음", dependencies=[Depends(require_login)])
async def mark_all_read(request: Request, session: AsyncSession = Depends(db.session)):
    return await noti_controller.mark_all_read(request, session)


@router.delete("", summary="전체 삭제", dependencies=[Depends(require_login)])
async def delete_all(request: Request, session: AsyncSession = Depends(db.session)):
    return await noti_controller.delete_all(request, session)
