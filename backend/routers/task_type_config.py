from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import task_type_config as type_schema
from core.controller import task_type_config as type_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.get("", summary="Task type 목록", dependencies=[Depends(require_login)])
async def list_task_types(branch_id: int, request: Request,
                          session: AsyncSession = Depends(db.session)):
    return await type_controller.get_list(branch_id, request, session)


@router.post("", summary="Task type 생성", dependencies=[Depends(require_login)])
async def create_task_type(branch_id: int, request: Request,
                           body: type_schema.TaskTypeCreate,
                           session: AsyncSession = Depends(db.session)):
    return await type_controller.create(branch_id, body, request, session)


@router.patch("/{type_id}", summary="Task type 수정", dependencies=[Depends(require_login)])
async def update_task_type(branch_id: int, type_id: int, request: Request,
                           body: type_schema.TaskTypeUpdate,
                           session: AsyncSession = Depends(db.session)):
    return await type_controller.update(branch_id, type_id, body, request, session)


@router.delete("/{type_id}", summary="Task type 삭제", dependencies=[Depends(require_login)])
async def delete_task_type(branch_id: int, type_id: int, request: Request,
                           session: AsyncSession = Depends(db.session)):
    return await type_controller.delete(branch_id, type_id, request, session)
