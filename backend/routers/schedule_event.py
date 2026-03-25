from datetime import date

from fastapi import APIRouter, Request, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import schedule_event as event_schema
from core.controller import schedule_event as event_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.get("/calendar-tasks", summary="캘린더 표시용 Task 목록", dependencies=[Depends(require_login)])
async def get_calendar_tasks(branch_id: int,
                             range_start: date = Query(...),
                             range_end: date = Query(...),
                             request: Request = None,
                             session: AsyncSession = Depends(db.session)):
    return await event_controller.get_calendar_tasks(branch_id, range_start, range_end, request, session)


@router.get("/calendar-epics", summary="캘린더 표시용 Epic 목록", dependencies=[Depends(require_login)])
async def get_calendar_epics(branch_id: int,
                             range_start: date = Query(...),
                             range_end: date = Query(...),
                             request: Request = None,
                             session: AsyncSession = Depends(db.session)):
    return await event_controller.get_calendar_epics(branch_id, range_start, range_end, request, session)


@router.get("", summary="Schedule event 목록", dependencies=[Depends(require_login)])
async def list_events(branch_id: int,
                      range_start: date = Query(...),
                      range_end: date = Query(...),
                      request: Request = None,
                      session: AsyncSession = Depends(db.session)):
    return await event_controller.get_list(branch_id, range_start, range_end, request, session)


@router.post("", summary="Schedule event 생성", dependencies=[Depends(require_login)])
async def create_event(branch_id: int, body: event_schema.ScheduleEventCreate,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await event_controller.create(body, branch_id, request, session)


@router.patch("/{event_id}", summary="Schedule event 수정", dependencies=[Depends(require_login)])
async def update_event(branch_id: int, event_id: int,
                       body: event_schema.ScheduleEventUpdate,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await event_controller.update(event_id, body, branch_id, request, session)


@router.delete("/{event_id}", summary="Schedule event 삭제", dependencies=[Depends(require_login)])
async def delete_event(branch_id: int, event_id: int,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await event_controller.delete(event_id, branch_id, request, session)
