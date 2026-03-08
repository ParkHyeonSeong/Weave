from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import custom_field as cf_schema
from core.controller import custom_field as cf_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.get("", summary="Custom field 목록", dependencies=[Depends(require_login)])
async def list_fields(branch_id: int, type_id: int, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await cf_controller.list_fields(branch_id, type_id, request, session)


@router.post("", summary="Custom field 생성", dependencies=[Depends(require_login)])
async def create_field(branch_id: int, type_id: int, body: cf_schema.CustomFieldCreate,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await cf_controller.create_field(branch_id, type_id, body, request, session)


@router.patch("/{field_id}", summary="Custom field 수정", dependencies=[Depends(require_login)])
async def update_field(branch_id: int, type_id: int, field_id: int,
                       body: cf_schema.CustomFieldUpdate,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await cf_controller.update_field(branch_id, type_id, field_id, body, request, session)


@router.delete("/{field_id}", summary="Custom field 삭제", dependencies=[Depends(require_login)])
async def delete_field(branch_id: int, type_id: int, field_id: int,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await cf_controller.delete_field(branch_id, type_id, field_id, request, session)


@router.post("/reorder", summary="Custom field 순서 변경", dependencies=[Depends(require_login)])
async def reorder_fields(branch_id: int, type_id: int, body: cf_schema.CustomFieldReorder,
                         request: Request, session: AsyncSession = Depends(db.session)):
    return await cf_controller.reorder_fields(branch_id, type_id, body, request, session)
