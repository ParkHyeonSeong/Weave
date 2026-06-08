import logging

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import JWT_SECRET_KEY, JWT_ALGORITHM, COOKIE_NAME
from library.ws_collab_manager import scrum_week_collab_manager
from core.model import scrum_member as member_model
from core.model import scrum_week as week_model
import db_engine as db

logger = logging.getLogger("weave.ws_scrum")
router = APIRouter()


def _verify_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        if payload.get('user_id'):
            return payload
    except Exception:
        pass
    return None


@router.websocket("/ws/scrum/{board_id}/weeks/{week_id}")
async def websocket_scrum_week(ws: WebSocket, board_id: int, week_id: int):
    """스크럼 주간 그리드 실시간 협업 WebSocket"""
    token = ws.cookies.get(COOKIE_NAME, '')
    payload = _verify_token(token)
    if not payload:
        await ws.close(code=4001, reason="Unauthorized")
        return

    user_id = payload['user_id']

    async with db.transactional_session() as session:
        if not await member_model.is_member(board_id, user_id, session):
            await ws.close(code=4003, reason="Not a member")
            return
        week = await week_model.find_by_id(week_id, session)
        if not week or week['board_id'] != board_id:
            await ws.close(code=4004, reason="Week not found")
            return

    await ws.accept()

    # join을 try 안에 둬서 join 실패 시에도 finally의 leave가 보장되게 함.
    # leave는 room 부재 시 no-op이라 실패한 join 뒤 호출도 안전.
    try:
        async with db.transactional_session() as session:
            await scrum_week_collab_manager.join(week_id, user_id, ws, session)
        while True:
            data = await ws.receive_bytes()
            await scrum_week_collab_manager.handle_message(week_id, ws, data)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("scrum week ws error (week_id=%s)", week_id)
    finally:
        await scrum_week_collab_manager.leave(week_id, user_id, ws)
