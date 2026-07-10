from typing import Literal

from fastapi import APIRouter, Request, Depends, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import canvas_page as page_schema
from core.controller import canvas_page as page_controller
from core.controller import canvas_upload
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="Canvas 페이지 생성", dependencies=[Depends(require_login)])
async def create_page(canvas_id: int, request: Request,
                      body: page_schema.CanvasPageCreate,
                      session: AsyncSession = Depends(db.session)):
    return await page_controller.create(canvas_id, body, request, session)


@router.get("", summary="페이지 트리", dependencies=[Depends(require_login)])
async def get_page_tree(canvas_id: int, request: Request,
                        session: AsyncSession = Depends(db.session)):
    return await page_controller.get_tree(canvas_id, request, session)


@router.get("/{page_id}", summary="페이지 상세", dependencies=[Depends(require_login)])
async def get_page(canvas_id: int, page_id: int, request: Request,
                   format: Literal['html', 'markdown'] = 'html',
                   session: AsyncSession = Depends(db.session)):
    return await page_controller.get_detail(canvas_id, page_id, request, session, fmt=format)


@router.patch("/{page_id}", summary="페이지 수정", dependencies=[Depends(require_login)])
async def update_page(canvas_id: int, page_id: int, request: Request,
                      body: page_schema.CanvasPageUpdate,
                      session: AsyncSession = Depends(db.session)):
    return await page_controller.update(canvas_id, page_id, body, request, session)


@router.patch("/{page_id}/move", summary="페이지 이동", dependencies=[Depends(require_login)])
async def move_page(canvas_id: int, page_id: int, request: Request,
                    body: page_schema.CanvasPageMove,
                    session: AsyncSession = Depends(db.session)):
    return await page_controller.move(canvas_id, page_id, body, request, session)


@router.post("/upload-image", summary="Canvas 이미지 업로드", dependencies=[Depends(require_login)])
async def upload_image(canvas_id: int, request: Request,
                       file: UploadFile = File(...),
                       session: AsyncSession = Depends(db.session)):
    return await canvas_upload.upload_image(canvas_id, file, request, session)


@router.post("/{page_id}/copy", summary="페이지 복제", dependencies=[Depends(require_login)])
async def copy_page(canvas_id: int, page_id: int, request: Request,
                    body: page_schema.CanvasPageCopy,
                    session: AsyncSession = Depends(db.session)):
    return await page_controller.copy(canvas_id, page_id, body, request, session)


@router.delete("/{page_id}", summary="페이지 삭제", dependencies=[Depends(require_login)])
async def delete_page(canvas_id: int, page_id: int, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await page_controller.delete(canvas_id, page_id, request, session)
