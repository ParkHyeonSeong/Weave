from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.controller import scrum_retro as retro_controller
from library.validator import require_login
from routers.schema.scrum_cell import RetroCellWrite
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


@router.get("/{board_id}/retros/{retro_id}/cells",
            summary="회고 셀 내용 조회", dependencies=[Depends(require_login)])
async def get_retro_cells(board_id: int, retro_id: int, request: Request,
                          session: AsyncSession = Depends(db.session)):
    return await retro_controller.get_retro_cells(board_id, retro_id, request, session)


@router.patch("/{board_id}/retros/{retro_id}/cells",
              summary="본인 회고 KPT 셀 쓰기", dependencies=[Depends(require_login)])
async def write_retro_cell(board_id: int, retro_id: int, body: RetroCellWrite,
                           request: Request, session: AsyncSession = Depends(db.session)):
    return await retro_controller.write_retro_cell(board_id, retro_id, body, request, session)
