from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import workflow_status as ws_schema
from core.controller import workflow_status as ws_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.get("", summary="Workflow status 목록", dependencies=[Depends(require_login)])
async def list_statuses(branch_id: int, request: Request,
                        session: AsyncSession = Depends(db.session)):
    return await ws_controller.list_statuses(branch_id, request, session)


@router.post("", summary="Workflow status 생성", dependencies=[Depends(require_login)])
async def create_status(branch_id: int, body: ws_schema.WorkflowStatusCreate,
                        request: Request, session: AsyncSession = Depends(db.session)):
    return await ws_controller.create_status(branch_id, body, request, session)


@router.patch("/{status_id}", summary="Workflow status 수정", dependencies=[Depends(require_login)])
async def update_status(branch_id: int, status_id: int,
                        body: ws_schema.WorkflowStatusUpdate,
                        request: Request, session: AsyncSession = Depends(db.session)):
    return await ws_controller.update_status(branch_id, status_id, body, request, session)


@router.delete("/{status_id}", summary="Workflow status 삭제", dependencies=[Depends(require_login)])
async def delete_status(branch_id: int, status_id: int,
                        request: Request, session: AsyncSession = Depends(db.session)):
    return await ws_controller.delete_status(branch_id, status_id, request, session)


@router.post("/reorder", summary="Workflow status 순서 변경", dependencies=[Depends(require_login)])
async def reorder_statuses(branch_id: int, body: ws_schema.WorkflowStatusReorder,
                           request: Request, session: AsyncSession = Depends(db.session)):
    return await ws_controller.reorder_statuses(branch_id, body, request, session)
