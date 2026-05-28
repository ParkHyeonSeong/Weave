from fastapi import APIRouter, Request, Depends, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import branch as branch_schema
from core.controller import branch as branch_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="Branch 생성", dependencies=[Depends(require_login)])
async def create_branch(request: Request, body: branch_schema.BranchCreate,
                        session: AsyncSession = Depends(db.session)):
    return await branch_controller.create(body, request, session)


@router.get("", summary="Branch 목록", dependencies=[Depends(require_login)])
async def list_branches(request: Request, session: AsyncSession = Depends(db.session)):
    return await branch_controller.get_list(request, session)


@router.get("/public", summary="Public Branch 탐색", dependencies=[Depends(require_login)])
async def list_public_branches(request: Request, session: AsyncSession = Depends(db.session)):
    return await branch_controller.get_public_list(request, session)


@router.get("/{branch_id}", summary="Branch 상세", dependencies=[Depends(require_login)])
async def get_branch(branch_id: int, request: Request,
                     session: AsyncSession = Depends(db.session)):
    return await branch_controller.get_detail(branch_id, request, session)


@router.patch("/{branch_id}", summary="Branch 수정", dependencies=[Depends(require_login)])
async def update_branch(branch_id: int, request: Request,
                        body: branch_schema.BranchUpdate,
                        session: AsyncSession = Depends(db.session)):
    return await branch_controller.update(branch_id, body, request, session)


@router.post("/{branch_id}/icon-upload", summary="Branch 아이콘 이미지 업로드",
             dependencies=[Depends(require_login)])
async def upload_branch_icon(branch_id: int, request: Request,
                             file: UploadFile = File(...),
                             session: AsyncSession = Depends(db.session)):
    return await branch_controller.upload_icon(branch_id, file, request, session)


@router.delete("/{branch_id}", summary="Branch 삭제", dependencies=[Depends(require_login)])
async def delete_branch(branch_id: int, request: Request,
                        session: AsyncSession = Depends(db.session)):
    return await branch_controller.delete(branch_id, request, session)


@router.post("/{branch_id}/leave", summary="Branch 나가기", dependencies=[Depends(require_login)])
async def leave_branch(branch_id: int, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await branch_controller.leave(branch_id, request, session)


@router.post("/{branch_id}/join", summary="Public Branch 가입", dependencies=[Depends(require_login)])
async def join_branch(branch_id: int, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await branch_controller.join(branch_id, request, session)


@router.get("/{branch_id}/members", summary="Branch 멤버 목록", dependencies=[Depends(require_login)])
async def list_branch_members(branch_id: int, request: Request,
                              session: AsyncSession = Depends(db.session)):
    return await branch_controller.get_members(branch_id, request, session)


@router.get("/{branch_id}/members/search", summary="초대 가능 사용자 검색", dependencies=[Depends(require_login)])
async def search_non_members(branch_id: int, q: str = '', request: Request = None,
                             session: AsyncSession = Depends(db.session)):
    return await branch_controller.search_non_members(branch_id, q, request, session)


@router.post("/{branch_id}/members", summary="멤버 초대", dependencies=[Depends(require_login)])
async def add_branch_member(branch_id: int, request: Request,
                            body: branch_schema.BranchMemberAdd,
                            session: AsyncSession = Depends(db.session)):
    return await branch_controller.add_member(branch_id, body, request, session)


@router.patch("/{branch_id}/members/{user_id}", summary="멤버 역할 변경", dependencies=[Depends(require_login)])
async def update_member_role(branch_id: int, user_id: int, request: Request,
                             body: branch_schema.BranchMemberRoleUpdate,
                             session: AsyncSession = Depends(db.session)):
    return await branch_controller.update_member_role(branch_id, user_id, body, request, session)


@router.delete("/{branch_id}/members/{user_id}", summary="멤버 제거", dependencies=[Depends(require_login)])
async def remove_branch_member(branch_id: int, user_id: int, request: Request,
                               session: AsyncSession = Depends(db.session)):
    return await branch_controller.remove_member(branch_id, user_id, request, session)
