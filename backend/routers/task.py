from typing import Optional
from fastapi import APIRouter, Request, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import task as task_schema
from core.controller import task as task_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="Task 생성", dependencies=[Depends(require_login)])
async def create_task(branch_id: int, body: task_schema.TaskCreate,
                      request: Request, session: AsyncSession = Depends(db.session)):
    return await task_controller.create(body, branch_id, request, session)


@router.get("", summary="Task 목록", dependencies=[Depends(require_login)])
async def list_tasks(branch_id: int, request: Request,
                     sprint_id: Optional[int] = Query(None),
                     session: AsyncSession = Depends(db.session)):
    return await task_controller.get_list(branch_id, sprint_id, request, session)


@router.get("/board", summary="Board 탭 데이터", dependencies=[Depends(require_login)])
async def get_board(branch_id: int, request: Request,
                    sprint_id: Optional[int] = Query(None),
                    session: AsyncSession = Depends(db.session)):
    return await task_controller.get_board(branch_id, sprint_id, request, session)


@router.get("/{task_id}", summary="Task 상세", dependencies=[Depends(require_login)])
async def get_task(branch_id: int, task_id: int, request: Request,
                   session: AsyncSession = Depends(db.session)):
    return await task_controller.get_detail(task_id, branch_id, request, session)


@router.patch("/{task_id}", summary="Task 수정", dependencies=[Depends(require_login)])
async def update_task(branch_id: int, task_id: int, body: task_schema.TaskUpdate,
                      request: Request, session: AsyncSession = Depends(db.session)):
    return await task_controller.update(task_id, body, branch_id, request, session)


@router.delete("/{task_id}", summary="Task 삭제", dependencies=[Depends(require_login)])
async def delete_task(branch_id: int, task_id: int, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await task_controller.delete(task_id, branch_id, request, session)
