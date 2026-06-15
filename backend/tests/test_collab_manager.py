from pycrdt import Doc, Text, XmlElement, XmlFragment, XmlText

from library import ws_collab_manager as cm


class FakeStore:
    def __init__(self, initial=None):
        self._state = initial
        self.saved = None
    async def get_yjs_state(self, room_id, db):
        return self._state
    async def save_yjs_state(self, room_id, state, db):
        self.saved = state


class FakeWS:
    def __init__(self):
        self.sent = []
    async def send_bytes(self, data):
        self.sent.append(data)


async def test_join_creates_room_keyed_by_room_id():
    mgr = cm.CollabManager(FakeStore())
    ws = FakeWS()
    room = await mgr.join(7, 42, ws, db_session=None)
    assert 7 in mgr.rooms
    assert room.room_id == 7
    assert (42, ws) in room.connections


async def test_join_loads_initial_state_from_store():
    seed = Doc()
    seed["t"] = Text("hello")
    state = seed.get_update()
    empty_len = len(Doc().get_update())
    mgr = cm.CollabManager(FakeStore(initial=state))
    room = await mgr.join(1, 1, FakeWS(), db_session=None)
    # 빈 doc보다 큰 상태 = store의 초기 state가 실제로 로드됨
    assert len(room.doc.get_update()) > empty_len


async def test_persist_writes_through_store():
    store = FakeStore()
    mgr = cm.CollabManager(store)
    room = await mgr.join(3, 1, FakeWS(), db_session=None)
    room.dirty = True
    await mgr._persist(room, db_session=None)
    assert store.saved is not None


async def test_separate_managers_have_isolated_rooms():
    a = cm.CollabManager(FakeStore())
    b = cm.CollabManager(FakeStore())
    await a.join(1, 1, FakeWS(), db_session=None)
    assert 1 in a.rooms and 1 not in b.rooms


def test_default_managers_exist():
    assert isinstance(cm.collab_manager, cm.CollabManager)
    assert isinstance(cm.scrum_week_collab_manager, cm.CollabManager)
    assert isinstance(cm.scrum_retro_collab_manager, cm.CollabManager)
    # 싱글턴이 올바른 store 타입을 주입받았는지 (복붙 실수 방지)
    assert isinstance(cm.collab_manager.store, cm.CanvasPageStore)
    assert isinstance(cm.scrum_week_collab_manager.store, cm.ScrumWeekStore)
    assert isinstance(cm.scrum_retro_collab_manager.store, cm.ScrumRetroStore)


def _write_hi(doc):
    frag = doc.get("c", type=XmlFragment)
    para = XmlElement("paragraph")
    frag.children.append(para)
    para.children.append(XmlText("hi"))


async def test_external_mutation_no_room_writes_to_store():
    store = FakeStore()
    mgr = cm.CollabManager(store)
    await mgr.apply_external_mutation(5, _write_hi, db_session=None)
    assert store.saved is not None
    # 저장된 state를 다시 읽으면 내용이 보존됨
    doc = Doc(); doc.apply_update(store.saved)
    assert "hi" in str(doc.get("c", type=XmlFragment))


async def test_external_mutation_active_room_broadcasts_and_marks_dirty():
    store = FakeStore()
    mgr = cm.CollabManager(store)
    ws = FakeWS()
    await mgr.join(6, 1, ws, db_session=None)
    await mgr.apply_external_mutation(6, _write_hi, db_session=None)
    room = mgr.rooms[6]
    assert room.dirty is True
    assert "hi" in str(room.doc.get("c", type=XmlFragment))
    assert ws.sent, "연결된 클라이언트에 브로드캐스트되어야 함"


async def test_snapshot_state_prefers_live_room():
    store = FakeStore(initial=None)
    mgr = cm.CollabManager(store)
    await mgr.join(8, 1, FakeWS(), db_session=None)
    await mgr.apply_external_mutation(8, _write_hi, db_session=None)
    snap = await mgr.snapshot_state(8, db_session=None)
    doc = Doc(); doc.apply_update(snap)
    assert "hi" in str(doc.get("c", type=XmlFragment))


async def test_snapshot_state_falls_back_to_store():
    seed = Doc(); seed["t"] = Text("x")
    mgr = cm.CollabManager(FakeStore(initial=seed.get_update()))
    snap = await mgr.snapshot_state(9, db_session=None)
    assert snap is not None
