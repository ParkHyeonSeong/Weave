import asyncio
import logging

from fastapi import WebSocket
from pycrdt import Doc

from core.model import canvas_page as page_model
import db_engine as db

logger = logging.getLogger("weave.collab")

# y-protocols message types (first byte)
MSG_SYNC = 0
MSG_AWARENESS = 1

# Sync sub-types (second byte for MSG_SYNC)
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
    __slots__ = ('page_id', 'doc', 'connections', 'awareness_states',
                 'persist_task', 'dirty')

    def __init__(self, page_id: int, doc: Doc):
        self.page_id = page_id
        self.doc = doc
        self.connections: list[tuple[int, WebSocket]] = []
        self.awareness_states: dict[int, bytes] = {}
        self.persist_task: asyncio.Task | None = None
        self.dirty = False


class CollabManager:
    def __init__(self):
        self.rooms: dict[int, Room] = {}

    async def join(self, page_id: int, user_id: int, ws: WebSocket,
                   db_session) -> Room:
        """방 입장: YDoc 로드, 클라이언트 등록"""
        if page_id not in self.rooms:
            yjs_state = await page_model.get_yjs_state(page_id, db_session)
            doc = Doc()
            if yjs_state:
                doc.apply_update(yjs_state)
            self.rooms[page_id] = Room(page_id, doc)

        room = self.rooms[page_id]
        room.connections.append((user_id, ws))

        # 기존 awareness states를 새 클라이언트에 전송
        for client_id, state_bytes in room.awareness_states.items():
            await self._send_raw(ws, state_bytes)

        logger.info("User %d joined page %d (%d connections)",
                     user_id, page_id, len(room.connections))
        return room

    async def leave(self, page_id: int, user_id: int, ws: WebSocket):
        """방 퇴장"""
        room = self.rooms.get(page_id)
        if not room:
            return

        room.connections = [
            (uid, w) for uid, w in room.connections if w != ws
        ]

        logger.info("User %d left page %d (%d remaining)",
                     user_id, page_id, len(room.connections))

        if not room.connections:
            if room.persist_task and not room.persist_task.done():
                room.persist_task.cancel()

            if room.dirty:
                async with db.AsyncSessionLocal() as session:
                    await self._persist(room, session)

            del self.rooms[page_id]
            logger.info("Room for page %d closed", page_id)

    async def handle_message(self, page_id: int, sender_ws: WebSocket,
                             data: bytes):
        """수신된 binary 메시지 처리"""
        if len(data) < 1:
            return

        room = self.rooms.get(page_id)
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
            # Client sends state vector → respond with diff (sync step 2)
            try:
                sv_len, offset = _read_var_uint(data, 2)
                client_sv = data[offset:offset + sv_len]
                # Send sync step 2: updates the client is missing
                response = _encode_update(room.doc, client_sv)
                await self._send_raw(sender_ws, response)
                # Send our state vector so client sends us what we're missing
                sv_msg = _encode_state_vector(room.doc)
                await self._send_raw(sender_ws, sv_msg)
            except Exception as e:
                logger.warning("Sync step 1 error for page %d: %s",
                               room.page_id, e)
                # Fallback: send full state
                response = _encode_update(room.doc)
                await self._send_raw(sender_ws, response)

        elif sync_type == SYNC_STEP2 or sync_type == SYNC_UPDATE:
            # Client sends update → apply to doc and relay
            try:
                update_len, offset = _read_var_uint(data, 2)
                update = data[offset:offset + update_len]
                room.doc.apply_update(update)
                room.dirty = True
                self._schedule_persist(room)
            except Exception as e:
                logger.warning("Failed to apply update to page %d: %s",
                               room.page_id, e)
                return

            # Relay to other clients
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
            async with db.AsyncSessionLocal() as session:
                await self._persist(room, session)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Failed to persist page %d: %s", room.page_id, e)

    async def _persist(self, room: Room, db_session):
        try:
            state = room.doc.get_update()
            await page_model.save_yjs_state(
                room.page_id, state, None, db_session
            )
            room.dirty = False
            logger.info("Persisted page %d (%d bytes)", room.page_id, len(state))
        except Exception as e:
            logger.error("Persist failed for page %d: %s", room.page_id, e)

    async def persist_all(self):
        """서버 종료 시 모든 활성 room 영속화"""
        for page_id, room in list(self.rooms.items()):
            if room.dirty:
                try:
                    async with db.AsyncSessionLocal() as session:
                        await self._persist(room, session)
                except Exception as e:
                    logger.error("Shutdown persist failed for page %d: %s",
                                 page_id, e)


collab_manager = CollabManager()
