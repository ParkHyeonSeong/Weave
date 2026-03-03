from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import auth as auth_schema
from core.controller import auth as auth_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("/login", summary="로그인")
async def login(request: Request, body: auth_schema.UserLogin, session: AsyncSession = Depends(db.session)):
    return await auth_controller.login(body, request, session)


@router.post("/register", summary="회원가입")
async def register(request: Request, body: auth_schema.UserRegister, session: AsyncSession = Depends(db.session)):
    return await auth_controller.register(body, request, session)


@router.get("/health", summary="인증 상태 확인", dependencies=[Depends(require_login)])
async def health_check(request: Request):
    return await auth_controller.health_check(request)
