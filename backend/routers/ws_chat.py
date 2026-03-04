import json
import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from config import JWT_SECRET_KEY, JWT_ALGORITHM
from library.ws_manager import manager
from core.model import chat_message as message_model
from core.model import chat_member as member_model
import db_engine as db

router = APIRouter()


def _verify_token(token: str) -> dict | None:
    """JWT 토큰 검증"""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        if payload.get('user_id'):
            return payload
    except Exception:
        pass
    return None


@router.websocket("/ws/chat")
async def websocket_chat(ws: WebSocket, token: str = Query(...)):
    """채팅 WebSocket 엔드포인트"""
    # JWT 인증
    payload = _verify_token(token)
    if not payload:
        await ws.close(code=4001, reason="Unauthorized")
        return

    user_id = payload['user_id']
    username = payload.get('username', '')

    await manager.connect(user_id, ws)

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            action = data.get('action')

            if action == 'send_message':
                room_id = data.get('room_id')
                content = data.get('content', '').strip()
                if not room_id or not content:
                    continue

                # DB 세션 생성 (WebSocket은 Depends 사용 불가)
                async with db.AsyncSessionLocal() as session:
                    # 멤버 확인
                    if not await member_model.is_member(room_id, user_id, session):
                        continue

                    # 메시지 저장
                    msg = await message_model.create(room_id, user_id, content, session)

                    # room 멤버에게 broadcast
                    await manager.broadcast_to_room(room_id, {
                        'type': 'new_message',
                        'room_id': room_id,
                        'message': {
                            'message_id': msg['message_id'],
                            'room_id': msg['room_id'],
                            'sender_id': msg['sender_id'],
                            'sender_name': username,
                            'content': msg['content'],
                            'created_at': msg['created_at'],
                        },
                    }, session)

            elif action == 'mark_read':
                room_id = data.get('room_id')
                if not room_id:
                    continue

                async with db.AsyncSessionLocal() as session:
                    await member_model.update_last_read(room_id, user_id, session)

    except WebSocketDisconnect:
        manager.disconnect(user_id, ws)
    except Exception:
        manager.disconnect(user_id, ws)
