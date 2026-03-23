from typing import Optional
from fastapi import APIRouter, Request, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import canvas_annotation as schema
from core.controller import canvas_annotation as controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


# -- 앵커 --

@router.post("", summary="앵커 + 첫 댓글 생성", dependencies=[Depends(require_login)])
async def create_annotation(canvas_id: int, page_id: int, body: schema.AnnotationCreate,
                            request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.create_annotation(body, canvas_id, page_id, request, session)


@router.get("", summary="앵커 목록", dependencies=[Depends(require_login)])
async def list_annotations(canvas_id: int, page_id: int,
                           status: Optional[str] = Query(None),
                           request: Request = None,
                           session: AsyncSession = Depends(db.session)):
    return await controller.list_annotations(canvas_id, page_id, status, request, session)


@router.patch("/{annotation_id}", summary="앵커 상태 변경", dependencies=[Depends(require_login)])
async def update_annotation(canvas_id: int, page_id: int, annotation_id: int,
                            body: schema.AnnotationUpdate,
                            request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.update_annotation(body, canvas_id, page_id, annotation_id, request, session)


@router.delete("/{annotation_id}", summary="앵커 삭제", dependencies=[Depends(require_login)])
async def delete_annotation(canvas_id: int, page_id: int, annotation_id: int,
                            request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.delete_annotation(canvas_id, page_id, annotation_id, request, session)


# -- 답글 --

@router.post("/{annotation_id}/replies", summary="답글 추가", dependencies=[Depends(require_login)])
async def create_reply(canvas_id: int, page_id: int, annotation_id: int,
                       body: schema.ReplyCreate,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.create_reply(body, canvas_id, page_id, annotation_id, request, session)


@router.patch("/{annotation_id}/replies/{reply_id}", summary="답글 수정", dependencies=[Depends(require_login)])
async def update_reply(canvas_id: int, page_id: int, annotation_id: int, reply_id: int,
                       body: schema.ReplyUpdate,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.update_reply(body, canvas_id, page_id, annotation_id, reply_id, request, session)


@router.delete("/{annotation_id}/replies/{reply_id}", summary="답글 삭제", dependencies=[Depends(require_login)])
async def delete_reply(canvas_id: int, page_id: int, annotation_id: int, reply_id: int,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.delete_reply(canvas_id, page_id, annotation_id, reply_id, request, session)
