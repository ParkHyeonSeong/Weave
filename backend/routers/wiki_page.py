from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import wiki_page as page_schema
from core.controller import wiki_page as page_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="Wiki 페이지 생성", dependencies=[Depends(require_login)])
async def create_page(canvas_id: int, request: Request,
                      body: page_schema.WikiPageCreate,
                      session: AsyncSession = Depends(db.session)):
    return await page_controller.create(canvas_id, body, request, session)


@router.get("", summary="페이지 트리", dependencies=[Depends(require_login)])
async def get_page_tree(canvas_id: int, request: Request,
                        session: AsyncSession = Depends(db.session)):
    return await page_controller.get_tree(canvas_id, request, session)


@router.get("/{page_id}", summary="페이지 상세", dependencies=[Depends(require_login)])
async def get_page(canvas_id: int, page_id: int, request: Request,
                   session: AsyncSession = Depends(db.session)):
    return await page_controller.get_detail(canvas_id, page_id, request, session)


@router.patch("/{page_id}", summary="페이지 수정", dependencies=[Depends(require_login)])
async def update_page(canvas_id: int, page_id: int, request: Request,
                      body: page_schema.WikiPageUpdate,
                      session: AsyncSession = Depends(db.session)):
    return await page_controller.update(canvas_id, page_id, body, request, session)


@router.patch("/{page_id}/move", summary="페이지 이동", dependencies=[Depends(require_login)])
async def move_page(canvas_id: int, page_id: int, request: Request,
                    body: page_schema.WikiPageMove,
                    session: AsyncSession = Depends(db.session)):
    return await page_controller.move(canvas_id, page_id, body, request, session)


@router.delete("/{page_id}", summary="페이지 삭제", dependencies=[Depends(require_login)])
async def delete_page(canvas_id: int, page_id: int, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await page_controller.delete(canvas_id, page_id, request, session)
