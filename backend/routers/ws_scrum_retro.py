import logging
import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import JWT_SECRET_KEY, JWT_ALGORITHM, COOKIE_NAME, DEBUG
from library.ws_collab_manager import scrum_retro_collab_manager
from core.model import scrum_member as member_model
from core.model import scrum_retro as retro_model
import db_engine as db

logger = logging.getLogger("weave.ws_scrum_retro")
router = APIRouter()


def _verify_token(token: str):
    try:
        p = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        if p.get('user_id'):
            return p
    except Exception:
        pass
    return None


@router.websocket("/ws/scrum/{board_id}/retros/{retro_id}")
async def websocket_scrum_retro(ws: WebSocket, board_id: int, retro_id: int):
    payload = _verify_token(ws.cookies.get(COOKIE_NAME, ''))
    if not payload:
        await ws.close(code=4001, reason="Unauthorized")
        return
    user_id = payload['user_id']
    async with db.transactional_session() as session:
        if not await member_model.is_member(board_id, user_id, session):
            await ws.close(code=4003, reason="Not a member")
            return
        retro = await retro_model.find_by_id(retro_id, session)
        if not retro or retro['board_id'] != board_id:
            await ws.close(code=4004, reason="Retro not found")
            return
    await ws.accept()
    try:
        async with db.transactional_session() as session:
            await scrum_retro_collab_manager.join(retro_id, user_id, ws, session)
        while True:
            data = await ws.receive_bytes()
            await scrum_retro_collab_manager.handle_message(retro_id, ws, data)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.error("scrum retro ws error (retro_id=%s)", retro_id, exc_info=DEBUG)
    finally:
        await scrum_retro_collab_manager.leave(retro_id, user_id, ws)
