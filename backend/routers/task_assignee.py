from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import task_subresource as sub_schema
from core.controller import task_subresource as sub_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="Task 담당자 추가", dependencies=[Depends(require_login)])
async def add_assignee(branch_id: int, task_id: int, body: sub_schema.TaskAssigneeAdd,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await sub_controller.add_task_assignee(
        task_id, body.user_id, body.role, branch_id, request, session)


@router.delete("/{user_id}", summary="Task 담당자 제거", dependencies=[Depends(require_login)])
async def remove_assignee(branch_id: int, task_id: int, user_id: int,
                          request: Request, session: AsyncSession = Depends(db.session)):
    return await sub_controller.remove_task_assignee(task_id, user_id, branch_id, request, session)
