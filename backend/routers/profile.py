from fastapi import APIRouter, Request, Response, Depends, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import profile as profile_schema
from core.controller import profile as profile_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.get("/me", summary="내 프로필 조회", dependencies=[Depends(require_login)])
async def get_profile(request: Request, session: AsyncSession = Depends(db.session)):
    return await profile_controller.get_profile(request, session)


@router.patch("/username", summary="사용자 이름 변경", dependencies=[Depends(require_login)])
async def update_username(body: profile_schema.UpdateUsername, request: Request, response: Response,
                          session: AsyncSession = Depends(db.session)):
    return await profile_controller.update_username(body, request, response, session)


@router.patch("/password", summary="비밀번호 변경", dependencies=[Depends(require_login)])
async def update_password(body: profile_schema.UpdatePassword, request: Request,
                          session: AsyncSession = Depends(db.session)):
    return await profile_controller.update_password(body, request, session)


@router.post("/avatar", summary="아바타 업로드", dependencies=[Depends(require_login)])
async def upload_avatar(request: Request, file: UploadFile = File(...),
                        session: AsyncSession = Depends(db.session)):
    return await profile_controller.upload_avatar(file, request, session)
