from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import scrum_board as scrum_schema
from core.controller import scrum_board as scrum_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


# ----- 보드 -----
@router.post("", summary="스크럼 보드 생성", dependencies=[Depends(require_login)])
async def create_board(body: scrum_schema.ScrumBoardCreate, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await scrum_controller.create(body, request, session)


@router.get("", summary="내 스크럼 보드 목록", dependencies=[Depends(require_login)])
async def list_boards(request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await scrum_controller.get_list(request, session)


@router.get("/archived", summary="아카이브된 스크럼 보드 목록", dependencies=[Depends(require_login)])
async def archived_boards(request: Request, session: AsyncSession = Depends(db.session)):
    return await scrum_controller.list_archived(request, session)


@router.get("/{board_id:int}", summary="보드 상세", dependencies=[Depends(require_login)])
async def get_board(board_id: int, request: Request,
                    session: AsyncSession = Depends(db.session)):
    return await scrum_controller.get_detail(board_id, request, session)


@router.patch("/{board_id:int}", summary="보드 수정", dependencies=[Depends(require_login)])
async def update_board(board_id: int, body: scrum_schema.ScrumBoardUpdate,
                       request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await scrum_controller.update(board_id, body, request, session)


@router.delete("/{board_id:int}", summary="보드 아카이브", dependencies=[Depends(require_login)])
async def delete_board(board_id: int, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await scrum_controller.delete(board_id, request, session)


@router.post("/{board_id:int}/restore", summary="보드 복원", dependencies=[Depends(require_login)])
async def restore_board(board_id: int, request: Request,
                        session: AsyncSession = Depends(db.session)):
    return await scrum_controller.restore(board_id, request, session)


@router.post("/{board_id:int}/leave", summary="보드 나가기", dependencies=[Depends(require_login)])
async def leave_board(board_id: int, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await scrum_controller.leave(board_id, request, session)


@router.delete("/{board_id:int}/permanent", summary="보드 영구삭제", dependencies=[Depends(require_login)])
async def permanent_board(board_id: int, request: Request,
                          session: AsyncSession = Depends(db.session)):
    return await scrum_controller.permanent_delete(board_id, request, session)


# ----- 멤버 -----
@router.get("/{board_id}/members", summary="멤버 목록", dependencies=[Depends(require_login)])
async def list_members(board_id: int, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await scrum_controller.get_members(board_id, request, session)


@router.get("/{board_id}/members/search", summary="초대 가능 사용자 검색",
            dependencies=[Depends(require_login)])
async def search_members(board_id: int, q: str = '', request: Request = None,
                         session: AsyncSession = Depends(db.session)):
    return await scrum_controller.search_invite_candidates(board_id, q, request, session)


@router.post("/{board_id}/members", summary="멤버 추가", dependencies=[Depends(require_login)])
async def add_member(board_id: int, body: scrum_schema.ScrumMemberAdd,
                     request: Request,
                     session: AsyncSession = Depends(db.session)):
    return await scrum_controller.add_member(board_id, body, request, session)


@router.patch("/{board_id}/members/{user_id}", summary="멤버 role 변경",
              dependencies=[Depends(require_login)])
async def update_member_role(board_id: int, user_id: int,
                             body: scrum_schema.ScrumMemberRoleUpdate,
                             request: Request,
                             session: AsyncSession = Depends(db.session)):
    return await scrum_controller.update_member_role(board_id, user_id, body, request, session)


@router.delete("/{board_id}/members/{user_id}", summary="멤버 제거",
               dependencies=[Depends(require_login)])
async def remove_member(board_id: int, user_id: int, request: Request,
                        session: AsyncSession = Depends(db.session)):
    return await scrum_controller.remove_member(board_id, user_id, request, session)
