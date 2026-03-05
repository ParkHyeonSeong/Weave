from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import epic as epic_schema
from core.controller import epic as epic_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="Epic 생성", dependencies=[Depends(require_login)])
async def create_epic(branch_id: int, body: epic_schema.EpicCreate,
                      request: Request, session: AsyncSession = Depends(db.session)):
    return await epic_controller.create(body, branch_id, request, session)


@router.get("", summary="Epic 목록", dependencies=[Depends(require_login)])
async def list_epics(branch_id: int, request: Request,
                     session: AsyncSession = Depends(db.session)):
    return await epic_controller.get_list(branch_id, request, session)


@router.patch("/{epic_id}", summary="Epic 수정", dependencies=[Depends(require_login)])
async def update_epic(branch_id: int, epic_id: int, body: epic_schema.EpicUpdate,
                      request: Request, session: AsyncSession = Depends(db.session)):
    return await epic_controller.update(epic_id, body, branch_id, request, session)


@router.delete("/{epic_id}", summary="Epic 삭제", dependencies=[Depends(require_login)])
async def delete_epic(branch_id: int, epic_id: int, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await epic_controller.delete(epic_id, branch_id, request, session)
