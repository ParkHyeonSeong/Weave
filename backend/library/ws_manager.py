import asyncio
import json
import time
from fastapi import WebSocket
from sqlalchemy import text


class ConnectionManager:
    """WebSocket 연결 관리자"""

    def __init__(self):
        # user_id -> [WebSocket, ...]  (동일 사용자 멀티탭 지원)
        self.active_connections: dict[int, list[WebSocket]] = {}

    async def connect(self, user_id: int, ws: WebSocket):
        await ws.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(ws)

    def disconnect(self, user_id: int, ws: WebSocket):
        if user_id in self.active_connections:
            self.active_connections[user_id] = [
                conn for conn in self.active_connections[user_id] if conn != ws
            ]
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    async def send_to_user(self, user_id: int, data: dict):
        """특정 사용자의 모든 연결에 메시지 전송"""
        if user_id in self.active_connections:
            message = json.dumps(data, default=str)
            dead_connections = []
            for ws in self.active_connections[user_id]:
                try:
                    await ws.send_text(message)
                except Exception:
                    dead_connections.append(ws)
            # 끊어진 연결 정리
            for ws in dead_connections:
                self.disconnect(user_id, ws)

    def get_online_user_ids(self) -> list[int]:
        """현재 접속 중인 사용자 ID 목록"""
        return list(self.active_connections.keys())

    def is_online(self, user_id: int) -> bool:
        return user_id in self.active_connections

    async def broadcast_to_all(self, data: dict):
        """접속 중인 모든 사용자에게 메시지 전송"""
        for uid in list(self.active_connections.keys()):
            await self.send_to_user(uid, data)

    async def broadcast_to_room(self, room_id: int, data: dict, db):
        """채팅방 멤버 중 온라인 사용자에게 broadcast"""
        result = await db.execute(text("""
            SELECT user_id FROM chat_room_member WHERE room_id = :room_id
        """), {'room_id': room_id})
        member_ids = [row[0] for row in result.fetchall()]

        for uid in member_ids:
            await self.send_to_user(uid, data)


# 싱글톤 인스턴스
manager = ConnectionManager()


def schedule_token_expiry_close(ws, payload, code: int = 4002, skew_secs: float = 5.0):
    """access 토큰 만료 약간 전(skew_secs)에 WS를 닫는 백그라운드 태스크(선제 종료).
    만료 직전에 닫아 클라가 갱신할 여유를 준다 — 클라는 닫힘을 받고 새 쿠키로 재연결(SEC-29).
    정상 종료 시 호출부 finally에서 .cancel() 해야 한다. payload에 exp가 없으면 None.
    (클라는 close 시 항상 토큰을 갱신·재연결하므로, 만료 전 종료라도 재연결-즉시-재종료 루프는 없다.)"""
    exp = payload.get('exp')
    if not exp:
        return None
    delay = exp - time.time() - skew_secs

    async def _closer():
        try:
            if delay > 0:
                await asyncio.sleep(delay)
            await ws.close(code=code)
        except Exception:
            pass

    return asyncio.create_task(_closer())
