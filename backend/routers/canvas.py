from fastapi import APIRouter, Request, Depends, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import canvas as canvas_schema
from core.controller import canvas as canvas_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="Canvas 생성", dependencies=[Depends(require_login)])
async def create_canvas(request: Request, body: canvas_schema.CanvasCreate,
                        session: AsyncSession = Depends(db.session)):
    return await canvas_controller.create(body, request, session)


@router.get("", summary="Canvas 목록", dependencies=[Depends(require_login)])
async def list_canvases(request: Request, session: AsyncSession = Depends(db.session)):
    return await canvas_controller.get_list(request, session)


@router.get("/public", summary="Public Canvas 탐색", dependencies=[Depends(require_login)])
async def list_public_canvases(request: Request, session: AsyncSession = Depends(db.session)):
    return await canvas_controller.get_public_list(request, session)


# 주의: /{canvas_id} 보다 위에 선언해야 "home-stats"가 canvas_id로 매칭되지 않음.
@router.get("/home-stats", summary="Canvas 홈 KPI 집계", dependencies=[Depends(require_login)])
async def get_canvas_home_stats(request: Request, session: AsyncSession = Depends(db.session)):
    return await canvas_controller.get_home_stats(request, session)


@router.get("/{canvas_id}", summary="Canvas 상세", dependencies=[Depends(require_login)])
async def get_canvas(canvas_id: int, request: Request,
                     session: AsyncSession = Depends(db.session)):
    return await canvas_controller.get_detail(canvas_id, request, session)


@router.patch("/{canvas_id}", summary="Canvas 수정", dependencies=[Depends(require_login)])
async def update_canvas(canvas_id: int, request: Request,
                        body: canvas_schema.CanvasUpdate,
                        session: AsyncSession = Depends(db.session)):
    return await canvas_controller.update(canvas_id, body, request, session)


@router.post("/{canvas_id}/icon-upload", summary="Canvas 아이콘 이미지 업로드",
             dependencies=[Depends(require_login)])
async def upload_canvas_icon(canvas_id: int, request: Request,
                             file: UploadFile = File(...),
                             session: AsyncSession = Depends(db.session)):
    return await canvas_controller.upload_icon(canvas_id, file, request, session)


@router.delete("/{canvas_id}", summary="Canvas 삭제", dependencies=[Depends(require_login)])
async def delete_canvas(canvas_id: int, request: Request,
                        session: AsyncSession = Depends(db.session)):
    return await canvas_controller.delete(canvas_id, request, session)


@router.post("/{canvas_id}/leave", summary="Canvas 나가기", dependencies=[Depends(require_login)])
async def leave_canvas(canvas_id: int, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await canvas_controller.leave(canvas_id, request, session)


@router.post("/{canvas_id}/join", summary="Public Canvas 가입", dependencies=[Depends(require_login)])
async def join_canvas(canvas_id: int, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await canvas_controller.join(canvas_id, request, session)


@router.get("/{canvas_id}/members", summary="Canvas 멤버 목록", dependencies=[Depends(require_login)])
async def list_canvas_members(canvas_id: int, request: Request,
                              session: AsyncSession = Depends(db.session)):
    return await canvas_controller.get_members(canvas_id, request, session)


@router.get("/{canvas_id}/members/search", summary="초대 가능 사용자 검색", dependencies=[Depends(require_login)])
async def search_non_members(canvas_id: int, q: str = '', request: Request = None,
                             session: AsyncSession = Depends(db.session)):
    return await canvas_controller.search_non_members(canvas_id, q, request, session)


@router.post("/{canvas_id}/members", summary="멤버 초대", dependencies=[Depends(require_login)])
async def add_canvas_member(canvas_id: int, request: Request,
                            body: canvas_schema.CanvasMemberAdd,
                            session: AsyncSession = Depends(db.session)):
    return await canvas_controller.add_member(canvas_id, body, request, session)


@router.patch("/{canvas_id}/members/{user_id}", summary="멤버 역할 변경", dependencies=[Depends(require_login)])
async def update_member_role(canvas_id: int, user_id: int, request: Request,
                             body: canvas_schema.CanvasMemberRoleUpdate,
                             session: AsyncSession = Depends(db.session)):
    return await canvas_controller.update_member_role(canvas_id, user_id, body, request, session)


@router.delete("/{canvas_id}/members/{user_id}", summary="멤버 제거", dependencies=[Depends(require_login)])
async def remove_canvas_member(canvas_id: int, user_id: int, request: Request,
                               session: AsyncSession = Depends(db.session)):
    return await canvas_controller.remove_member(canvas_id, user_id, request, session)
