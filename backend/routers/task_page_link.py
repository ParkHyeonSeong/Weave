from fastapi import APIRouter, Request, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import task_page_link as link_schema
from core.controller import task_page_link as link_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="태스크에 페이지 연결", dependencies=[Depends(require_login)])
async def link_page(branch_id: int, task_id: int, body: link_schema.PageLinkCreate,
                    request: Request, session: AsyncSession = Depends(db.session)):
    return await link_controller.link_page(body, branch_id, task_id, request, session)


@router.get("", summary="연결된 페이지 목록", dependencies=[Depends(require_login)])
async def get_linked_pages(branch_id: int, task_id: int,
                           request: Request, session: AsyncSession = Depends(db.session)):
    return await link_controller.get_pages(branch_id, task_id, request, session)


@router.get("/search", summary="페이지 검색", dependencies=[Depends(require_login)])
async def search_pages(branch_id: int, task_id: int, q: str = Query("", min_length=1),
                       request: Request = None, session: AsyncSession = Depends(db.session)):
    return await link_controller.search_pages(branch_id, task_id, q, request, session)


@router.delete("/{link_id}", summary="페이지 연결 해제", dependencies=[Depends(require_login)])
async def unlink_page(branch_id: int, task_id: int, link_id: int,
                      request: Request, session: AsyncSession = Depends(db.session)):
    return await link_controller.unlink_page(branch_id, task_id, link_id, request, session)
