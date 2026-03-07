from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import task as task_model
from core.model import task_issue as issue_model
from library.validator import require_login
import db_engine as db

router = APIRouter()


class RefStatusRequest(BaseModel):
    task_ids: List[int] = []
    issue_ids: List[int] = []

    @field_validator('task_ids', 'issue_ids')
    @classmethod
    def limit_ids(cls, v):
        if len(v) > 200:
            raise ValueError('최대 200개까지 가능합니다')
        return v


@router.post("", summary="Ref 상태 배치 조회", dependencies=[Depends(require_login)])
async def batch_ref_status(
    body: RefStatusRequest,
    session: AsyncSession = Depends(db.session),
):
    tasks = await task_model.batch_statuses(body.task_ids, session)
    issues = await issue_model.batch_statuses(body.issue_ids, session)
    return {'status': True, 'tasks': tasks, 'issues': issues}
