from fastapi import APIRouter, Request, Response, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import auth as auth_schema
from core.controller import auth as auth_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("/login", summary="로그인")
async def login(request: Request, response: Response, body: auth_schema.UserLogin,
                session: AsyncSession = Depends(db.session)):
    return await auth_controller.login(body, request, response, session)


@router.post("/register", summary="회원가입")
async def register(request: Request, response: Response, body: auth_schema.UserRegister,
                   session: AsyncSession = Depends(db.session)):
    return await auth_controller.register(body, request, response, session)


@router.get("/me", summary="현재 사용자 프로필", dependencies=[Depends(require_login)])
async def me(request: Request):
    return await auth_controller.me(request)


@router.post("/logout", summary="로그아웃")
async def logout(response: Response):
    return await auth_controller.logout(response)
