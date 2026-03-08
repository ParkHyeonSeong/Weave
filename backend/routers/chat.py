from fastapi import APIRouter, Request, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import chat as chat_schema
from core.controller import chat as chat_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="채팅방 생성", dependencies=[Depends(require_login)])
async def create_room(request: Request, body: chat_schema.ChatRoomCreate,
                      session: AsyncSession = Depends(db.session)):
    return await chat_controller.create_room(body, request, session)


@router.get("", summary="내 채팅방 목록", dependencies=[Depends(require_login)])
async def list_rooms(request: Request, session: AsyncSession = Depends(db.session)):
    return await chat_controller.get_rooms(request, session)


@router.get("/task-search", summary="채팅용 Task 검색",
            dependencies=[Depends(require_login)])
async def search_tasks(request: Request,
                       q: str = Query('', max_length=100),
                       mode: str = Query('my'),
                       session: AsyncSession = Depends(db.session)):
    return await chat_controller.search_tasks(q, mode, request, session)


@router.get("/doc-search", summary="채팅용 문서 검색",
            dependencies=[Depends(require_login)])
async def search_docs(request: Request,
                      q: str = Query('', max_length=100),
                      session: AsyncSession = Depends(db.session)):
    return await chat_controller.search_docs(q, request, session)


@router.get("/issue-search", summary="채팅용 이슈 검색",
            dependencies=[Depends(require_login)])
async def search_issues(request: Request,
                        q: str = Query('', max_length=100),
                        session: AsyncSession = Depends(db.session)):
    return await chat_controller.search_issues(q, request, session)


@router.get("/mention-search", summary="@멘션 사용자 검색",
            dependencies=[Depends(require_login)])
async def mention_search(request: Request,
                         q: str = Query('', max_length=100),
                         room_id: int = Query(None),
                         branch_id: int = Query(None),
                         session: AsyncSession = Depends(db.session)):
    return await chat_controller.search_mentions(q, request, session,
                                                  room_id=room_id, branch_id=branch_id)


@router.get("/users", summary="전체 사용자 목록", dependencies=[Depends(require_login)])
async def list_users(session: AsyncSession = Depends(db.session)):
    return await chat_controller.get_users(session)


@router.get("/{room_id}/messages", summary="채팅방 메시지 목록",
            dependencies=[Depends(require_login)])
async def list_messages(room_id: int, request: Request,
                        limit: int = Query(50, ge=1, le=100),
                        offset: int = Query(0, ge=0),
                        session: AsyncSession = Depends(db.session)):
    return await chat_controller.get_messages(room_id, request, session, limit, offset)


@router.patch("/{room_id}/name", summary="채팅방 이름 변경",
              dependencies=[Depends(require_login)])
async def rename_room(room_id: int, request: Request,
                      body: chat_schema.ChatRoomRename,
                      session: AsyncSession = Depends(db.session)):
    return await chat_controller.rename_room(room_id, body, request, session)
