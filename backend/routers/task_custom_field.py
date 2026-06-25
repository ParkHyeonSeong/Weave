from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import task_subresource as sub_schema
from core.controller import task_subresource as sub_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.patch("", summary="Task custom field 값 설정(단일 키 병합)",
              dependencies=[Depends(require_login)])
async def set_custom_field(branch_id: int, task_id: int, body: sub_schema.TaskCustomFieldSet,
                           request: Request, session: AsyncSession = Depends(db.session)):
    return await sub_controller.set_task_custom_field(
        task_id, body.field_id, body.value, branch_id, request, session)
