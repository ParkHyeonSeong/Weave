from fastapi import APIRouter, Request, Response, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import auth as auth_schema
from core.controller import auth as auth_controller
from library.validator import require_login
from library.rate_limiter import limiter
import db_engine as db

router = APIRouter()


@router.post("/login", summary="로그인")
@limiter.limit("5/minute")
async def login(request: Request, response: Response, body: auth_schema.UserLogin,
                session: AsyncSession = Depends(db.session)):
    return await auth_controller.login(body, request, response, session)


@router.post("/register", summary="회원가입")
@limiter.limit("3/minute")
async def register(request: Request, response: Response, body: auth_schema.UserRegister,
                   session: AsyncSession = Depends(db.session)):
    return await auth_controller.register(body, request, response, session)


@router.post("/reset-password", summary="재설정 토큰으로 비밀번호 변경")
@limiter.limit("5/minute")
async def reset_password(request: Request, body: auth_schema.ResetPassword,
                         session: AsyncSession = Depends(db.session)):
    return await auth_controller.reset_password(body, session)


@router.get("/me", summary="현재 사용자 프로필", dependencies=[Depends(require_login)])
async def me(request: Request):
    return await auth_controller.me(request)


@router.post("/refresh", summary="access 토큰 갱신 (refresh 쿠키)")
@limiter.limit("30/minute")
async def refresh(request: Request, response: Response,
                  session: AsyncSession = Depends(db.session)):
    return await auth_controller.refresh(request, response, session)


@router.post("/logout", summary="로그아웃")
@limiter.limit("20/minute")
async def logout(request: Request, response: Response,
                 session: AsyncSession = Depends(db.session)):
    return await auth_controller.logout(request, response, session)
