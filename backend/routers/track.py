from fastapi import APIRouter, Request, Depends, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import track as track_schema
from core.controller import track as track_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


# =========================================================================
# Track CRUD
# =========================================================================

@router.post("", summary="Track 생성", dependencies=[Depends(require_login)])
async def create_track(body: track_schema.TrackCreate, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await track_controller.create(body, request, session)


@router.get("", summary="내 Track 목록", dependencies=[Depends(require_login)])
async def list_tracks(request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await track_controller.get_list(request, session)


# 주의: /{track_id} 보다 위에 선언해야 "home-stats"가 track_id로 매칭되지 않음.
@router.get("/home-stats", summary="Track 홈 KPI 집계", dependencies=[Depends(require_login)])
async def get_track_home_stats(request: Request,
                               session: AsyncSession = Depends(db.session)):
    return await track_controller.get_home_stats(request, session)


# 주의: /{track_id} 보다 위에 선언해야 "archived"가 track_id로 매칭되지 않음.
@router.get("/archived", summary="아카이브된 Track 목록", dependencies=[Depends(require_login)])
async def archived_tracks(request: Request, session: AsyncSession = Depends(db.session)):
    return await track_controller.list_archived(request, session)


@router.get("/{track_id}", summary="Track 상세", dependencies=[Depends(require_login)])
async def get_track(track_id: int, request: Request,
                    session: AsyncSession = Depends(db.session)):
    return await track_controller.get_detail(track_id, request, session)


@router.patch("/{track_id}", summary="Track 수정", dependencies=[Depends(require_login)])
async def update_track(track_id: int, body: track_schema.TrackUpdate,
                       request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await track_controller.update(track_id, body, request, session)


@router.post("/{track_id}/icon-upload", summary="Track 아이콘 이미지 업로드",
             dependencies=[Depends(require_login)])
async def upload_track_icon(track_id: int, request: Request,
                            file: UploadFile = File(...),
                            session: AsyncSession = Depends(db.session)):
    return await track_controller.upload_icon(track_id, file, request, session)


@router.delete("/{track_id}", summary="Track 아카이브",
               dependencies=[Depends(require_login)])
async def delete_track(track_id: int, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await track_controller.delete(track_id, request, session)


@router.post("/{track_id}/restore", summary="Track 복원", dependencies=[Depends(require_login)])
async def restore_track(track_id: int, request: Request,
                        session: AsyncSession = Depends(db.session)):
    return await track_controller.restore(track_id, request, session)


@router.delete("/{track_id}/permanent", summary="Track 영구삭제", dependencies=[Depends(require_login)])
async def permanent_track(track_id: int, request: Request,
                          session: AsyncSession = Depends(db.session)):
    return await track_controller.permanent_delete(track_id, request, session)


# =========================================================================
# Members
# =========================================================================

@router.get("/{track_id}/members", summary="Track 멤버 목록",
            dependencies=[Depends(require_login)])
async def list_members(track_id: int, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await track_controller.get_members(track_id, request, session)


@router.get("/{track_id}/members/search", summary="초대 가능 사용자 검색",
            dependencies=[Depends(require_login)])
async def search_invite_candidates(track_id: int, q: str = '',
                                    request: Request = None,
                                    session: AsyncSession = Depends(db.session)):
    return await track_controller.search_invite_candidates(track_id, q, request, session)


@router.post("/{track_id}/members", summary="멤버 추가",
             dependencies=[Depends(require_login)])
async def add_member(track_id: int, body: track_schema.TrackMemberAdd,
                     request: Request,
                     session: AsyncSession = Depends(db.session)):
    return await track_controller.add_member(track_id, body, request, session)


@router.patch("/{track_id}/members/{user_id}", summary="멤버 role 변경",
              dependencies=[Depends(require_login)])
async def update_member_role(track_id: int, user_id: int,
                             body: track_schema.TrackMemberRoleUpdate,
                             request: Request,
                             session: AsyncSession = Depends(db.session)):
    return await track_controller.update_member_role(track_id, user_id, body, request, session)


@router.post("/{track_id}/leave", summary="Track 나가기", dependencies=[Depends(require_login)])
async def leave_track(track_id: int, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await track_controller.leave(track_id, request, session)


@router.delete("/{track_id}/members/{user_id}", summary="멤버 제거",
               dependencies=[Depends(require_login)])
async def remove_member(track_id: int, user_id: int, request: Request,
                        session: AsyncSession = Depends(db.session)):
    return await track_controller.remove_member(track_id, user_id, request, session)


# =========================================================================
# Participating branches
# =========================================================================

@router.get("/{track_id}/branches", summary="참여 branch 목록",
            dependencies=[Depends(require_login)])
async def list_branches(track_id: int, request: Request,
                        session: AsyncSession = Depends(db.session)):
    return await track_controller.get_branches(track_id, request, session)


@router.post("/{track_id}/branches", summary="참여 branch 추가",
             dependencies=[Depends(require_login)])
async def add_branch(track_id: int, body: track_schema.TrackBranchAdd,
                     request: Request,
                     session: AsyncSession = Depends(db.session)):
    return await track_controller.add_branch(track_id, body, request, session)


@router.delete("/{track_id}/branches/{branch_id}", summary="참여 branch 제거",
               dependencies=[Depends(require_login)])
async def remove_branch(track_id: int, branch_id: int, request: Request,
                        session: AsyncSession = Depends(db.session)):
    return await track_controller.remove_branch(track_id, branch_id, request, session)


@router.patch("/{track_id}/branches/{branch_id}",
              summary="참여 branch override (이름/색)",
              dependencies=[Depends(require_login)])
async def update_branch_override(track_id: int, branch_id: int,
                                  body: track_schema.TrackBranchOverride,
                                  request: Request,
                                  session: AsyncSession = Depends(db.session)):
    return await track_controller.update_branch_override(track_id, branch_id, body, request, session)


# =========================================================================
# Items
# =========================================================================

@router.get("/{track_id}/items", summary="Track item 목록",
            dependencies=[Depends(require_login)])
async def list_items(track_id: int, request: Request,
                     session: AsyncSession = Depends(db.session)):
    return await track_controller.get_items(track_id, request, session)


@router.post("/{track_id}/items", summary="task를 Track에 추가",
             dependencies=[Depends(require_login)])
async def add_item(track_id: int, body: track_schema.TrackItemAdd,
                   request: Request,
                   session: AsyncSession = Depends(db.session)):
    return await track_controller.add_item(track_id, body, request, session)


@router.post("/{track_id}/items/bulk", summary="N개의 task를 한 번에 Track에 추가",
             dependencies=[Depends(require_login)])
async def add_items_bulk(track_id: int, body: track_schema.TrackItemsBulkAdd,
                         request: Request,
                         session: AsyncSession = Depends(db.session)):
    return await track_controller.add_items_bulk(track_id, body, request, session)


@router.patch("/{track_id}/items/positions", summary="item 위치 bulk 저장",
              dependencies=[Depends(require_login)])
async def update_item_positions(track_id: int,
                                 body: track_schema.TrackItemPositionsUpdate,
                                 request: Request,
                                 session: AsyncSession = Depends(db.session)):
    return await track_controller.update_item_positions(track_id, body, request, session)


@router.delete("/{track_id}/items/{item_id}", summary="item 삭제",
               dependencies=[Depends(require_login)])
async def delete_item(track_id: int, item_id: int, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await track_controller.delete_item(track_id, item_id, request, session)


# =========================================================================
# Sources (SourcePicker)
# =========================================================================

@router.get("/{track_id}/sources", summary="SourcePicker용 task 검색",
            dependencies=[Depends(require_login)])
async def search_sources(track_id: int, request: Request,
                         session: AsyncSession = Depends(db.session)):
    return await track_controller.search_sources(track_id, request, session)


@router.get("/{track_id}/sidebar-tree",
            summary="Sidebar tree (branch → sprint/epic scope → tasks)",
            dependencies=[Depends(require_login)])
async def sidebar_tree(track_id: int, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await track_controller.sidebar_tree(track_id, request, session)


# =========================================================================
# Links (Track 내부 edge)
# =========================================================================

@router.get("/{track_id}/links", summary="Track link 목록",
            dependencies=[Depends(require_login)])
async def list_links(track_id: int, request: Request,
                     session: AsyncSession = Depends(db.session)):
    return await track_controller.get_links(track_id, request, session)


@router.post("/{track_id}/links", summary="edge 생성 (옵션: materialize)",
             dependencies=[Depends(require_login)])
async def add_link(track_id: int, body: track_schema.TrackLinkAdd,
                   request: Request,
                   session: AsyncSession = Depends(db.session)):
    return await track_controller.add_link(track_id, body, request, session)


@router.delete("/{track_id}/links/{link_id}", summary="edge 삭제",
               dependencies=[Depends(require_login)])
async def delete_link(track_id: int, link_id: int, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await track_controller.delete_link(track_id, link_id, request, session)
