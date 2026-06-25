from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import task_subresource as sub_schema
from core.controller import task_subresource as sub_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="Task 라벨 추가", dependencies=[Depends(require_login)])
async def add_label(branch_id: int, task_id: int, body: sub_schema.TaskLabelAdd,
                    request: Request, session: AsyncSession = Depends(db.session)):
    return await sub_controller.add_task_label(task_id, body.label_id, branch_id, request, session)


@router.delete("/{label_id}", summary="Task 라벨 제거", dependencies=[Depends(require_login)])
async def remove_label(branch_id: int, task_id: int, label_id: int,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await sub_controller.remove_task_label(task_id, label_id, branch_id, request, session)
