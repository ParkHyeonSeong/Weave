from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import ai as ai_schema
from core.controller import ai as ai_controller
from library.validator import require_login, require_admin
import db_engine as db

router = APIRouter()


@router.get("/config", summary="AI 설정 조회", dependencies=[Depends(require_admin)])
async def get_config(request: Request, session: AsyncSession = Depends(db.session)):
    return await ai_controller.get_config(request, session)


@router.put("/config", summary="AI 설정 변경", dependencies=[Depends(require_admin)])
async def update_config(body: ai_schema.AIConfigUpdate, request: Request,
                        session: AsyncSession = Depends(db.session)):
    return await ai_controller.save_config(body, request, session)


@router.get("/conversations", summary="AI 대화 목록",
            dependencies=[Depends(require_login)])
async def list_conversations(request: Request,
                             session: AsyncSession = Depends(db.session)):
    return await ai_controller.list_conversations(request, session)


@router.post("/conversations", summary="AI 대화 생성",
             dependencies=[Depends(require_login)])
async def create_conversation(body: ai_schema.AIConversationCreate, request: Request,
                              session: AsyncSession = Depends(db.session)):
    return await ai_controller.create_conversation(body, request, session)


@router.patch("/conversations/{conversation_id}", summary="AI 대화 제목 변경",
              dependencies=[Depends(require_login)])
async def update_conversation(conversation_id: int,
                              body: ai_schema.AIConversationCreate,
                              request: Request,
                              session: AsyncSession = Depends(db.session)):
    return await ai_controller.update_conversation_title(
        conversation_id, body.title, request, session
    )


@router.delete("/conversations/{conversation_id}", summary="AI 대화 삭제",
               dependencies=[Depends(require_login)])
async def delete_conversation(conversation_id: int, request: Request,
                              session: AsyncSession = Depends(db.session)):
    return await ai_controller.delete_conversation(conversation_id, request, session)


@router.get("/conversations/{conversation_id}/messages", summary="AI 메시지 목록",
            dependencies=[Depends(require_login)])
async def get_messages(conversation_id: int, request: Request,
                       session: AsyncSession = Depends(db.session)):
    return await ai_controller.get_messages(conversation_id, request, session)


@router.post("/conversations/{conversation_id}/chat", summary="AI 채팅 전송",
             dependencies=[Depends(require_login)])
async def send_message(conversation_id: int, body: ai_schema.AIChatMessage,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await ai_controller.send_message(conversation_id, body, request, session)


@router.post("/messages/{message_id}/pin", summary="AI 메시지 핀 토글",
             dependencies=[Depends(require_login)])
async def toggle_pin(message_id: int, request: Request,
                     session: AsyncSession = Depends(db.session)):
    return await ai_controller.toggle_pin(message_id, request, session)
