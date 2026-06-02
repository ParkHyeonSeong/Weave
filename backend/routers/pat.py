from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.controller import pat as pat_controller
from library.validator import require_login
from .schema import pat as pat_schema
import db_engine as db

router = APIRouter()


@router.post("", summary="액세스 토큰 생성", dependencies=[Depends(require_login)])
async def create_token(body: pat_schema.CreateToken, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await pat_controller.create_token(body, request, session)


@router.get("", summary="액세스 토큰 목록", dependencies=[Depends(require_login)])
async def list_tokens(request: Request, session: AsyncSession = Depends(db.session)):
    return await pat_controller.list_tokens(request, session)


@router.delete("/{pat_id}", summary="액세스 토큰 폐기", dependencies=[Depends(require_login)])
async def revoke_token(pat_id: int, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await pat_controller.revoke_token(pat_id, request, session)
