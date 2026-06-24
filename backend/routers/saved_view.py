from typing import Optional
from fastapi import APIRouter, Request, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import saved_view as schema
from core.controller import saved_view as controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="저장된 뷰 생성", dependencies=[Depends(require_login)])
async def create_view(body: schema.SavedViewCreate, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await controller.create(body, request, session)


@router.get("", summary="저장된 뷰 목록(scope_branch_id 옵션)", dependencies=[Depends(require_login)])
async def list_views(request: Request, scope_branch_id: Optional[int] = Query(None),
                     session: AsyncSession = Depends(db.session)):
    return await controller.get_list(scope_branch_id, request, session)


@router.get("/{view_id}", summary="뷰 상세", dependencies=[Depends(require_login)])
async def get_view(view_id: int, request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.get_detail(view_id, request, session)


@router.patch("/{view_id}", summary="뷰 수정", dependencies=[Depends(require_login)])
async def update_view(view_id: int, body: schema.SavedViewUpdate, request: Request,
                     session: AsyncSession = Depends(db.session)):
    return await controller.update(view_id, body, request, session)


@router.delete("/{view_id}", summary="뷰 삭제", dependencies=[Depends(require_login)])
async def delete_view(view_id: int, request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.delete(view_id, request, session)
