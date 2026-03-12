import json
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import JWT_SECRET_KEY, JWT_ALGORITHM, COOKIE_NAME
from library.ws_manager import manager
from core.model import chat_message as message_model
from core.model import chat_member as member_model
from core.model import task as task_model
from core.model import canvas_page as canvas_page_model
from core.model import task_issue as issue_model
from library import notification_service
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
async def websocket_chat(ws: WebSocket):
    """채팅 WebSocket 엔드포인트"""
    # 쿠키에서 JWT 인증
    token = ws.cookies.get(COOKIE_NAME, '')
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
                task_id = data.get('task_id')
                canvas_page_id = data.get('canvas_page_id')
                issue_id = data.get('issue_id')
                # content 또는 첨부 중 하나는 있어야 함
                if not room_id or (not content and not task_id and not canvas_page_id and not issue_id):
                    continue

                # DB 세션 생성 (WebSocket은 Depends 사용 불가)
                async with db.AsyncSessionLocal() as session:
                    # 멤버 확인
                    if not await member_model.is_member(room_id, user_id, session):
                        continue

                    # 메시지 저장
                    msg = await message_model.create(
                        room_id, user_id, content, session,
                        task_id=task_id, canvas_page_id=canvas_page_id,
                        issue_id=issue_id
                    )

                    # task_ref 정보 조회
                    task_ref = None
                    if task_id:
                        task = await task_model.find_by_id(task_id, session)
                        if task:
                            task_ref = {
                                'task_id': task['task_id'],
                                'branch_id': task['branch_id'],
                                'display_id': task['display_id'],
                                'title': task['title'],
                                'status': task['status'],
                                'priority': task['priority'],
                                'assignees': task.get('assignees', []),
                            }

                    # doc_ref 정보 조회
                    doc_ref = None
                    if canvas_page_id:
                        doc = await canvas_page_model.find_by_id_simple(canvas_page_id, session)
                        if doc:
                            doc_ref = {
                                'page_id': doc['page_id'],
                                'canvas_id': doc['canvas_id'],
                                'title': doc['title'],
                                'canvas_name': doc['canvas_name'],
                            }

                    # issue_ref 정보 조회
                    issue_ref = None
                    if issue_id:
                        issue = await issue_model.find_by_id_simple(issue_id, session)
                        if issue:
                            issue_ref = {
                                'issue_id': issue['issue_id'],
                                'task_id': issue['task_id'],
                                'branch_id': issue['branch_id'],
                                'display_id': issue['display_id'],
                                'title': issue['title'],
                                'status': issue['status'],
                            }

                    # @멘션 알림 처리
                    mentioned_user_ids = data.get('mentioned_user_ids', [])
                    if mentioned_user_ids:
                        await notification_service.notify_bulk(
                            mentioned_user_ids,
                            'chat_mention',
                            user_id,
                            f'{username}님이 채팅에서 회원님을 멘션했습니다',
                            None,
                            'chat_room',
                            room_id,
                            session,
                        )

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
                            'task_ref': task_ref,
                            'doc_ref': doc_ref,
                            'issue_ref': issue_ref,
                        },
                    }, session)

                    # 오프라인 멤버에게 Web Push
                    await notification_service.push_chat_to_offline(
                        room_id, user_id, username, content, session
                    )

            elif action == 'mark_read':
                room_id = data.get('room_id')
                if not room_id:
                    continue

                async with db.AsyncSessionLocal() as session:
                    await member_model.update_last_read(room_id, user_id, session)

                    # 상대방에게 읽음 알림 전송
                    await manager.broadcast_to_room(room_id, {
                        'type': 'mark_read',
                        'room_id': room_id,
                        'user_id': user_id,
                        'last_read_at': str(datetime.now(timezone.utc)),
                    }, session)

    except WebSocketDisconnect:
        manager.disconnect(user_id, ws)
    except Exception:
        manager.disconnect(user_id, ws)
