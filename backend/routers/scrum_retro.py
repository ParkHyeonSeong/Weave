from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.controller import scrum_retro as retro_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.get("/{board_id}/retros/current", summary="현재 회고 조회/생성",
            dependencies=[Depends(require_login)])
async def get_current(board_id: int, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await retro_controller.get_current(board_id, request, session)


@router.get("/{board_id}/retros", summary="회고 목록", dependencies=[Depends(require_login)])
async def list_retros(board_id: int, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await retro_controller.list_retros(board_id, request, session)
