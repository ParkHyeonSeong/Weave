from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import setup as setup_schema
from core.controller import setup as setup_controller
import db_engine as db

router = APIRouter()


@router.get("/status", summary="초기화 상태 확인")
async def check_status(session: AsyncSession = Depends(db.session)):
    return await setup_controller.check_initialized(session)


@router.post("/initialize", summary="초기 설정")
async def initialize(request: Request, body: setup_schema.SetupInitialize,
                     session: AsyncSession = Depends(db.session)):
    return await setup_controller.initialize(body, request, session)
