from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import label as label_schema
from core.controller import label as label_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="Label 생성", dependencies=[Depends(require_login)])
async def create_label(branch_id: int, body: label_schema.LabelCreate,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await label_controller.create(body, branch_id, request, session)


@router.get("", summary="Label 목록", dependencies=[Depends(require_login)])
async def list_labels(branch_id: int, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await label_controller.get_list(branch_id, request, session)


@router.patch("/{label_id}", summary="Label 수정", dependencies=[Depends(require_login)])
async def update_label(branch_id: int, label_id: int, body: label_schema.LabelUpdate,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await label_controller.update(label_id, body, branch_id, request, session)


@router.delete("/{label_id}", summary="Label 삭제", dependencies=[Depends(require_login)])
async def delete_label(branch_id: int, label_id: int, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await label_controller.delete(label_id, branch_id, request, session)
