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


@router.post("/{sprint_id}/start", summary="Sprint 시작", dependencies=[Depends(require_login)])
async def start_sprint(branch_id: int, sprint_id: int, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await sprint_controller.start(sprint_id, branch_id, request, session)


@router.post("/{sprint_id}/complete", summary="Sprint 완료", dependencies=[Depends(require_login)])
async def complete_sprint(branch_id: int, sprint_id: int,
                          body: sprint_schema.SprintComplete,
                          request: Request, session: AsyncSession = Depends(db.session)):
    return await sprint_controller.complete(sprint_id, body, branch_id, request, session)


@router.post("/reorder", summary="Sprint 순서 변경", dependencies=[Depends(require_login)])
async def reorder_sprints(branch_id: int, body: sprint_schema.SprintReorder,
                          request: Request, session: AsyncSession = Depends(db.session)):
    return await sprint_controller.reorder(body, branch_id, request, session)


@router.get("/{sprint_id}/task-counts", summary="Sprint task 수", dependencies=[Depends(require_login)])
async def sprint_task_counts(branch_id: int, sprint_id: int, request: Request,
                             session: AsyncSession = Depends(db.session)):
    return await sprint_controller.get_task_counts(sprint_id, branch_id, request, session)
