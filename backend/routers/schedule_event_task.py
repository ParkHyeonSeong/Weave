from fastapi import APIRouter, Request, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import schedule_event_task as link_schema
from core.controller import schedule_event_task as link_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.get("/search", summary="연결 가능한 태스크 검색", dependencies=[Depends(require_login)])
async def search_tasks(branch_id: int, event_id: int,
                       q: str = Query('', min_length=1),
                       request: Request = None,
                       session: AsyncSession = Depends(db.session)):
    return await link_controller.search_tasks(branch_id, event_id, q, request, session)


@router.get("", summary="연결된 태스크 목록", dependencies=[Depends(require_login)])
async def get_linked_tasks(branch_id: int, event_id: int,
                           request: Request = None,
                           session: AsyncSession = Depends(db.session)):
    return await link_controller.get_linked_tasks(branch_id, event_id, request, session)


@router.post("", summary="태스크 연결", dependencies=[Depends(require_login)])
async def link_task(branch_id: int, event_id: int,
                    body: link_schema.EventTaskLinkCreate,
                    request: Request,
                    session: AsyncSession = Depends(db.session)):
    return await link_controller.link_task(body, branch_id, event_id, request, session)


@router.delete("/{link_id}", summary="태스크 연결 해제", dependencies=[Depends(require_login)])
async def unlink_task(branch_id: int, event_id: int, link_id: int,
                      request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await link_controller.unlink_task(branch_id, event_id, link_id, request, session)
