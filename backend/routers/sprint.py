from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import sprint as sprint_schema
from core.controller import sprint as sprint_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="Sprint 생성", dependencies=[Depends(require_login)])
async def create_sprint(branch_id: int, body: sprint_schema.SprintCreate,
                        request: Request, session: AsyncSession = Depends(db.session)):
    return await sprint_controller.create(body, branch_id, request, session)


@router.get("", summary="Sprint 목록", dependencies=[Depends(require_login)])
async def list_sprints(branch_id: int, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await sprint_controller.get_list(branch_id, request, session)


@router.patch("/{sprint_id}", summary="Sprint 수정", dependencies=[Depends(require_login)])
async def update_sprint(branch_id: int, sprint_id: int, body: sprint_schema.SprintUpdate,
                        request: Request, session: AsyncSession = Depends(db.session)):
    return await sprint_controller.update(sprint_id, body, branch_id, request, session)


@router.delete("/{sprint_id}", summary="Sprint 삭제", dependencies=[Depends(require_login)])
async def delete_sprint(branch_id: int, sprint_id: int, request: Request,
                        session: AsyncSession = Depends(db.session)):
    return await sprint_controller.delete(sprint_id, branch_id, request, session)
