import logging
import time

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import (JWT_SECRET_KEY, JWT_ALGORITHM, COOKIE_NAME, DEBUG,
                    WS_MAX_MESSAGE_BYTES, WS_MEMBERSHIP_RECHECK_SECS)
from library.origins import reject_ws_if_forbidden_origin
from library.ws_collab_manager import collab_manager
from library.ws_manager import schedule_token_expiry_close
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
    if await reject_ws_if_forbidden_origin(ws):  # SEC-39: cross-site WebSocket hijacking 차단
        return
    # JWT 인증: cookie 기반
    token = ws.cookies.get(COOKIE_NAME, '')
    payload = _verify_token(token)
    if not payload:
        await ws.close(code=4001, reason="Unauthorized")
        return

    user_id = payload['user_id']

    # 멤버십 + 페이지 소속 확인
    async with db.transactional_session() as session:
        if not await member_model.is_member(canvas_id, user_id, session):
            await ws.close(code=4003, reason="Not a member")
            return

        page = await page_model.find_by_id(page_id, session)
        if not page or page['canvas_id'] != canvas_id:
            await ws.close(code=4004, reason="Page not found")
            return

    await ws.accept()

    # 토큰 만료 직전 서버가 선제 종료 → 클라가 새 쿠키로 재연결(SEC-29)
    expiry_task = schedule_token_expiry_close(ws, payload)

    # join을 try 안에 둬서 join 실패 시에도 finally의 leave가 보장되게 함
    # (leave는 room 부재 시 no-op이라 안전). ws_scrum 등 형제 핸들러와 동일 패턴.
    try:
        async with db.transactional_session() as session:
            await collab_manager.join(page_id, user_id, ws, session)
        last_check = time.monotonic()
        while True:
            data = await ws.receive_bytes()
            if len(data) > WS_MAX_MESSAGE_BYTES:  # SEC-20: 대형 프레임 차단
                await ws.close(code=1009, reason="Message too large")
                return
            # LOG-03: 연결 후 멤버십 재검증(스로틀) — 제거된 멤버의 편집 세션 차단
            if time.monotonic() - last_check >= WS_MEMBERSHIP_RECHECK_SECS:
                last_check = time.monotonic()
                async with db.transactional_session() as session:
                    if not await member_model.is_member(canvas_id, user_id, session):
                        await ws.close(code=4003, reason="Membership revoked")
                        return
            await collab_manager.handle_message(page_id, ws, data)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.error("canvas ws error (page_id=%s)", page_id, exc_info=DEBUG)
    finally:
        if expiry_task:
            expiry_task.cancel()
        await collab_manager.leave(page_id, user_id, ws)
