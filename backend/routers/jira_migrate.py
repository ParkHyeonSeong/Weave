from fastapi import APIRouter, Request, Depends, UploadFile, File
from pydantic import BaseModel
from typing import Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession

from core.controller import jira_migrate as jira_migrate_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


class JiraMigrateExecute(BaseModel):
    migration_id: str
    user_mapping: Dict[str, int] = {}  # Jira 이름 -> Weave user_id


@router.post("/preview", summary="Jira CSV 프리뷰", dependencies=[Depends(require_login)])
async def preview(branch_id: int, request: Request, file: UploadFile = File(...),
                  session: AsyncSession = Depends(db.session)):
    return await jira_migrate_controller.preview(branch_id, file, request, session)


@router.post("/execute", summary="Jira CSV 마이그레이션 실행", dependencies=[Depends(require_login)])
async def execute(branch_id: int, body: JiraMigrateExecute, request: Request,
                  session: AsyncSession = Depends(db.session)):
    return await jira_migrate_controller.execute(branch_id, body, request, session)
