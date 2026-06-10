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


@router.delete("/avatar", summary="아바타 사진 제거", dependencies=[Depends(require_login)])
async def delete_avatar(request: Request, session: AsyncSession = Depends(db.session)):
    return await profile_controller.delete_avatar(request, session)


@router.patch("/avatar-color", summary="아바타 색상 변경", dependencies=[Depends(require_login)])
async def update_avatar_color(body: profile_schema.UpdateAvatarColor, request: Request,
                              session: AsyncSession = Depends(db.session)):
    return await profile_controller.update_avatar_color(body, request, session)


@router.get("/ui-prefs", summary="뷰 상태 조회", dependencies=[Depends(require_login)])
async def get_ui_prefs(request: Request, session: AsyncSession = Depends(db.session)):
    user_id = request.state.payload['user_id']
    prefs = await user_model.get_ui_prefs(user_id, session)
    return {'status': True, 'ui_prefs': prefs or {}}


@router.patch("/ui-prefs", summary="뷰 상태 저장", dependencies=[Depends(require_login)])
async def update_ui_prefs(body: profile_schema.UpdateUiPrefs, request: Request,
                          session: AsyncSession = Depends(db.session)):
    user_id = request.state.payload['user_id']
    patch = body.model_dump(exclude_none=True)
    # DB에서 원자적 top-level 병합(경합 없음)
    await user_model.update_ui_prefs(user_id, patch, session)
    return {'status': True}
