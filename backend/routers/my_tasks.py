from typing import Optional

from fastapi import APIRouter, Request, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from core.controller import my_tasks as my_tasks_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.get("", summary="내 Task 목록", dependencies=[Depends(require_login)])
async def get_my_tasks(
    request: Request,
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    branch_id: Optional[int] = Query(None),
    sort_by: str = Query("updated"),
    session: AsyncSession = Depends(db.session),
):
    return await my_tasks_controller.get_my_tasks(
        status, priority, branch_id, sort_by, request, session
    )
