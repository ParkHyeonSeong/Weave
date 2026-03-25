from fastapi import APIRouter, Request, Response, Depends, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import profile as profile_schema
from core.controller import profile as profile_controller
from core.model import user as user_model
from library.validator import require_login
from library.rate_limiter import limiter
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


@router.post("/force-change-password", summary="강제 비밀번호 변경", dependencies=[Depends(require_login)])
@limiter.limit("5/minute")
async def force_change_password(body: profile_schema.ForceChangePassword, request: Request,
                                session: AsyncSession = Depends(db.session)):
    return await profile_controller.force_change_password(body, request, session)


@router.post("/avatar", summary="아바타 업로드", dependencies=[Depends(require_login)])
async def upload_avatar(request: Request, file: UploadFile = File(...),
                        session: AsyncSession = Depends(db.session)):
    return await profile_controller.upload_avatar(file, request, session)


@router.get("/sidebar-order", summary="사이드바 순서 조회", dependencies=[Depends(require_login)])
async def get_sidebar_order(request: Request, session: AsyncSession = Depends(db.session)):
    user_id = request.state.payload['user_id']
    order = await user_model.get_sidebar_order(user_id, session)
    return {'status': True, 'sidebar_order': order}


@router.patch("/sidebar-order", summary="사이드바 순서 저장", dependencies=[Depends(require_login)])
async def update_sidebar_order(body: profile_schema.UpdateSidebarOrder, request: Request,
                               session: AsyncSession = Depends(db.session)):
    user_id = request.state.payload['user_id']
    order = body.model_dump(exclude_none=True)
    # 기존 순서와 병합
    current = await user_model.get_sidebar_order(user_id, session) or {}
    current.update(order)
    await user_model.update_sidebar_order(user_id, current, session)
    return {'status': True, 'sidebar_order': current}
