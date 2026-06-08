import asyncio
import logging

from fastapi import WebSocket
from pycrdt import Doc

from core.model import canvas_page as canvas_page_model
from core.model import scrum_week as scrum_week_model
from core.model import scrum_retro as scrum_retro_model
import db_engine as db

logger = logging.getLogger("weave.collab")

MSG_SYNC = 0
MSG_AWARENESS = 1

SYNC_STEP1 = 0
SYNC_STEP2 = 1
SYNC_UPDATE = 2

PERSIST_DEBOUNCE_SECS = 30


def _read_var_uint(data: bytes, offset: int) -> tuple[int, int]:
    """Read a variable-length unsigned integer (LEB128)."""
    result = 0
    shift = 0
    while offset < len(data):
        byte = data[offset]
        offset += 1
        result |= (byte & 0x7F) << shift
        if (byte & 0x80) == 0:
            break
        shift += 7
    return result, offset


def _write_var_uint(value: int) -> bytes:
    """Write a variable-length unsigned integer (LEB128)."""
    result = bytearray()
    while value > 0x7F:
        result.append((value & 0x7F) | 0x80)
        value >>= 7
    result.append(value & 0x7F)
    return bytes(result)


def _encode_state_vector(doc: Doc) -> bytes:
    """Encode sync step 1 message: [MSG_SYNC, SYNC_STEP1, var_uint(len), sv]"""
    sv = doc.get_state()
    return bytes([MSG_SYNC, SYNC_STEP1]) + _write_var_uint(len(sv)) + sv


def _encode_update(doc: Doc, sv: bytes = None) -> bytes:
    """Encode sync step 2 message: [MSG_SYNC, SYNC_STEP2, var_uint(len), update]"""
    if sv is not None:
        update = doc.get_update(sv)
    else:
        update = doc.get_update()
    return bytes([MSG_SYNC, SYNC_STEP2]) + _write_var_uint(len(update)) + update


class Room:
    __slots__ = ('room_id', 'doc', 'connections', 'awareness_states',
                 'persist_task', 'dirty')

    def __init__(self, room_id: int, doc: Doc):
        self.room_id = room_id
        self.doc = doc
        self.connections: list[tuple[int, WebSocket]] = []
        self.awareness_states: dict[int, bytes] = {}
        self.persist_task: asyncio.Task | None = None
        self.dirty = False


class CollabManager:
    """Yjs 협업 룸 매니저. store는 async get_yjs_state(room_id, db) /
    save_yjs_state(room_id, state, db)를 제공한다. 매니저마다 rooms가 격리됨."""

    def __init__(self, store):
        self.store = store
        self.rooms: dict[int, Room] = {}

    async def join(self, room_id: int, user_id: int, ws: WebSocket,
                   db_session) -> Room:
        """방 입장: YDoc 로드, 클라이언트 등록"""
        if room_id not in self.rooms:
            yjs_state = await self.store.get_yjs_state(room_id, db_session)
            doc = Doc()
            if yjs_state:
                doc.apply_update(yjs_state)
            self.rooms[room_id] = Room(room_id, doc)

        room = self.rooms[room_id]
        room.connections.append((user_id, ws))

        for client_id, state_bytes in room.awareness_states.items():
            await self._send_raw(ws, state_bytes)

        logger.info("User %d joined room %d (%d connections)",
                     user_id, room_id, len(room.connections))
        return room

    async def leave(self, room_id: int, user_id: int, ws: WebSocket):
        """방 퇴장"""
        room = self.rooms.get(room_id)
        if not room:
            return

        room.connections = [
            (uid, w) for uid, w in room.connections if w != ws
        ]

        logger.info("User %d left room %d (%d remaining)",
                     user_id, room_id, len(room.connections))

        if not room.connections:
            if room.persist_task and not room.persist_task.done():
                room.persist_task.cancel()

            if room.dirty:
                async with db.transactional_session() as session:
                    await self._persist(room, session)

            del self.rooms[room_id]
            logger.info("Room %d closed", room_id)

    async def handle_message(self, room_id: int, sender_ws: WebSocket,
                             data: bytes):
        """수신된 binary 메시지 처리"""
        if len(data) < 1:
            return

        room = self.rooms.get(room_id)
        if not room:
            return

        msg_type = data[0]

        if msg_type == MSG_SYNC:
            await self._handle_sync(room, sender_ws, data)
        elif msg_type == MSG_AWARENESS:
            await self._handle_awareness(room, sender_ws, data)

    async def _handle_sync(self, room: Room, sender_ws: WebSocket,
                           data: bytes):
        """Yjs sync protocol 처리"""
        if len(data) < 2:
            return

        sync_type = data[1]

        if sync_type == SYNC_STEP1:
            try:
                sv_len, offset = _read_var_uint(data, 2)
                client_sv = data[offset:offset + sv_len]
                response = _encode_update(room.doc, client_sv)
                await self._send_raw(sender_ws, response)
                sv_msg = _encode_state_vector(room.doc)
                await self._send_raw(sender_ws, sv_msg)
            except Exception as e:
                logger.warning("Sync step 1 error for room %d: %s",
                               room.room_id, e)
                response = _encode_update(room.doc)
                await self._send_raw(sender_ws, response)

        elif sync_type == SYNC_STEP2 or sync_type == SYNC_UPDATE:
            try:
                update_len, offset = _read_var_uint(data, 2)
                update = data[offset:offset + update_len]
                room.doc.apply_update(update)
                room.dirty = True
                self._schedule_persist(room)
            except Exception as e:
                logger.warning("Failed to apply update to room %d: %s",
                               room.room_id, e)
                return

            await self._broadcast(room, sender_ws, data)

    async def _handle_awareness(self, room: Room, sender_ws: WebSocket,
                                data: bytes):
        """Awareness update relay + storage"""
        try:
            if len(data) > 2:
                _, offset = _read_var_uint(data, 1)
                _, offset2 = _read_var_uint(data, offset)
                if offset2 < len(data):
                    client_id, _ = _read_var_uint(data, offset2)
                    room.awareness_states[client_id] = data
        except Exception:
            pass

        await self._broadcast(room, sender_ws, data)

    async def _send_raw(self, ws: WebSocket, data: bytes):
        try:
            await ws.send_bytes(data)
        except Exception:
            pass

    async def _broadcast(self, room: Room, sender_ws: WebSocket,
                         data: bytes):
        """발신자 제외 broadcast"""
        dead = []
        for uid, ws in room.connections:
            if ws == sender_ws:
                continue
            try:
                await ws.send_bytes(data)
            except Exception:
                dead.append((uid, ws))

        for item in dead:
            room.connections = [c for c in room.connections if c != item]

    def _schedule_persist(self, room: Room):
        if room.persist_task and not room.persist_task.done():
            room.persist_task.cancel()

        room.persist_task = asyncio.create_task(
            self._debounced_persist(room)
        )

    async def _debounced_persist(self, room: Room):
        try:
            await asyncio.sleep(PERSIST_DEBOUNCE_SECS)
            async with db.transactional_session() as session:
                await self._persist(room, session)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Failed to persist room %d: %s", room.room_id, e)

    async def _persist(self, room: Room, db_session):
        try:
            state = room.doc.get_update()
            await self.store.save_yjs_state(room.room_id, state, db_session)
            room.dirty = False
            logger.info("Persisted room %d (%d bytes)", room.room_id, len(state))
        except Exception as e:
            logger.error("Persist failed for room %d: %s", room.room_id, e)

    async def persist_all(self):
        """서버 종료 시 모든 활성 room 영속화"""
        for room_id, room in list(self.rooms.items()):
            if room.dirty:
                try:
                    async with db.transactional_session() as session:
                        await self._persist(room, session)
                except Exception as e:
                    logger.error("Shutdown persist failed for room %d: %s",
                                 room_id, e)


class CanvasPageStore:
    """캔버스 페이지 yjs_state store (기존 동작 보존)."""
    async def get_yjs_state(self, room_id, db_session):
        return await canvas_page_model.get_yjs_state(room_id, db_session)

    async def save_yjs_state(self, room_id, state, db_session):
        await canvas_page_model.save_yjs_state(room_id, state, None, db_session)


class ScrumWeekStore:
    """스크럼 주(週) yjs_state store."""
    async def get_yjs_state(self, room_id, db_session):
        return await scrum_week_model.get_yjs_state(room_id, db_session)

    async def save_yjs_state(self, room_id, state, db_session):
        await scrum_week_model.save_yjs_state(room_id, state, db_session)


class ScrumRetroStore:
    """스크럼 회고 yjs_state store."""
    async def get_yjs_state(self, room_id, db_session):
        return await scrum_retro_model.get_yjs_state(room_id, db_session)

    async def save_yjs_state(self, room_id, state, db_session):
        await scrum_retro_model.save_yjs_state(room_id, state, db_session)


collab_manager = CollabManager(CanvasPageStore())
scrum_week_collab_manager = CollabManager(ScrumWeekStore())
scrum_retro_collab_manager = CollabManager(ScrumRetroStore())
