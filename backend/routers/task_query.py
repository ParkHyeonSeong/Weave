from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from .schema import task as task_schema
from core.controller import task as task_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("/query", summary="크로스브랜치 Task 쿼리", dependencies=[Depends(require_login)])
async def query_cross(body: task_schema.TaskQueryCross, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await task_controller.query_cross_branch(body, request, session)
