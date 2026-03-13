import logging

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import JWT_SECRET_KEY, JWT_ALGORITHM, COOKIE_NAME
from library.ws_collab_manager import collab_manager
from core.model import canvas_member as member_model
from core.model import canvas_page as page_model
import db_engine as db

logger = logging.getLogger("weave.ws_canvas")
router = APIRouter()


def _verify_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        if payload.get('user_id'):
            return payload
    except Exception:
        pass
    return None


@router.websocket("/ws/canvas/{canvas_id}/pages/{page_id}")
async def websocket_canvas_collab(ws: WebSocket, canvas_id: int, page_id: int):
    """Canvas 페이지 실시간 협업 WebSocket"""
    # JWT 인증: cookie 기반
    token = ws.cookies.get(COOKIE_NAME, '')
    payload = _verify_token(token)
    if not payload:
        await ws.close(code=4001, reason="Unauthorized")
        return

    user_id = payload['user_id']

    # 멤버십 + 페이지 소속 확인
    async with db.AsyncSessionLocal() as session:
        if not await member_model.is_member(canvas_id, user_id, session):
            await ws.close(code=4003, reason="Not a member")
            return

        page = await page_model.find_by_id(page_id, session)
        if not page or page['canvas_id'] != canvas_id:
            await ws.close(code=4004, reason="Page not found")
            return

    await ws.accept()

    # 방 입장
    async with db.AsyncSessionLocal() as session:
        await collab_manager.join(page_id, user_id, ws, session)

    try:
        while True:
            data = await ws.receive_bytes()
            await collab_manager.handle_message(page_id, ws, data)
    except WebSocketDisconnect:
        await collab_manager.leave(page_id, user_id, ws)
    except Exception:
        await collab_manager.leave(page_id, user_id, ws)
