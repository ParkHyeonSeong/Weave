from fastapi import APIRouter, Request, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from core.controller import activity_log as activity_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


# --- Task 활동 이력 ---

@router.get("/branches/{branch_id}/tasks/{task_id}/activity",
            summary="Task 활동 이력", dependencies=[Depends(require_login)])
async def get_task_activity(branch_id: int, task_id: int, request: Request,
                            limit: int = Query(20, ge=1, le=100),
                            offset: int = Query(0, ge=0),
                            session: AsyncSession = Depends(db.session)):
    return await activity_controller.get_task_activity(
        task_id, branch_id, limit, offset, request, session
    )


@router.get("/branches/{branch_id}/activity",
            summary="브랜치 활동 피드", dependencies=[Depends(require_login)])
async def get_branch_activity(branch_id: int, request: Request,
                              limit: int = Query(30, ge=1, le=100),
                              offset: int = Query(0, ge=0),
                              session: AsyncSession = Depends(db.session)):
    return await activity_controller.get_branch_activity(
        branch_id, limit, offset, request, session
    )


# --- Canvas 페이지 활동 이력 ---

@router.get("/canvases/{canvas_id}/pages/{page_id}/activity",
            summary="Canvas 페이지 활동 이력", dependencies=[Depends(require_login)])
async def get_canvas_page_activity(canvas_id: int, page_id: int, request: Request,
                                   limit: int = Query(20, ge=1, le=100),
                                   offset: int = Query(0, ge=0),
                                   session: AsyncSession = Depends(db.session)):
    return await activity_controller.get_canvas_page_activity(
        canvas_id, page_id, limit, offset, request, session
    )


@router.get("/canvases/{canvas_id}/activity",
            summary="캔버스 활동 피드", dependencies=[Depends(require_login)])
async def get_canvas_activity(canvas_id: int, request: Request,
                              limit: int = Query(30, ge=1, le=100),
                              offset: int = Query(0, ge=0),
                              session: AsyncSession = Depends(db.session)):
    return await activity_controller.get_canvas_activity(
        canvas_id, limit, offset, request, session
    )
