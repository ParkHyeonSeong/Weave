"""SEC-18/19: 업로드 인가.

- chat 업로드는 방 멤버만(SEC-18)
- 업로드 파일 서빙은 파일명 리소스 id로 멤버십 검증(SEC-19) — task/canvas/chat은 멤버만,
  avatars/*-icons는 인증 사용자 허용, 알 수 없는 경로는 거부
"""
import io
from types import SimpleNamespace

import bcrypt
from fastapi import UploadFile
from sqlalchemy import text

from core.controller import chat_upload
from routers import uploads as uploads_router


def _req(uid):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': uid}))


async def _user(db, email):
    pw = bcrypt.hashpw(b'x', bcrypt.gensalt())
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES (:e, :p, 'u', 'active', 'member') RETURNING user_id
    """), {'e': email, 'p': pw})
    return row.scalar_one()


async def _branch(db, uid, key):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES ('B', :k, 'd', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {'k': key, 'u': uid})
    return row.scalar_one()


async def _canvas(db, branch_id, uid, key):
    row = await db.execute(text("""
        INSERT INTO canvas (branch_id, canvas_name, key, visibility, created_by)
        VALUES (:b, 'C', :k, 'private', :u) RETURNING canvas_id
    """), {'b': branch_id, 'k': key, 'u': uid})
    return row.scalar_one()


async def _room(db, uid):
    row = await db.execute(text("""
        INSERT INTO chat_room (room_type, room_name, created_by)
        VALUES ('group', 'R', :u) RETURNING room_id
    """), {'u': uid})
    return row.scalar_one()


async def _add(db, sql, **p):
    await db.execute(text(sql), p)


# ── SEC-18: 채팅 업로드 멤버십 ─────────────────────────────────────────────

async def test_chat_upload_rejects_non_member(db_session):
    owner = await _user(db_session, 'ulo@t.local')
    outsider = await _user(db_session, 'uls@t.local')
    room = await _room(db_session, owner)
    await _add(db_session, "INSERT INTO chat_room_member (room_id, user_id) VALUES (:r,:u)", r=room, u=owner)
    f = UploadFile(filename='note.txt', file=io.BytesIO(b'hello'))
    res = await chat_upload.upload(room, f, _req(outsider), db_session)
    assert res['status'] is False and res['message'] == 'NOT_A_MEMBER'


async def test_chat_upload_member_succeeds_with_room_in_name(db_session):
    owner = await _user(db_session, 'ulm@t.local')
    room = await _room(db_session, owner)
    await _add(db_session, "INSERT INTO chat_room_member (room_id, user_id) VALUES (:r,:u)", r=room, u=owner)
    f = UploadFile(filename='note.txt', file=io.BytesIO(b'hello'))
    res = await chat_upload.upload(room, f, _req(owner), db_session)
    assert res['status'] is True
    assert f"/api/uploads/chat/chat_{room}_" in res['url']


# ── SEC-19: 서빙 인가(_is_authorized) ──────────────────────────────────────

async def test_serve_authz_task_member_only(db_session):
    owner = await _user(db_session, 'sa1@t.local')
    outsider = await _user(db_session, 'sa2@t.local')
    br = await _branch(db_session, owner, 'SAT')
    await _add(db_session, "INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b,:u,'admin')", b=br, u=owner)
    fn = f't{br}_abc123.png'
    assert await uploads_router._is_authorized('task', fn, owner, db_session) is True
    assert await uploads_router._is_authorized('task', fn, outsider, db_session) is False


async def test_serve_authz_canvas_member_only(db_session):
    owner = await _user(db_session, 'sc1@t.local')
    outsider = await _user(db_session, 'sc2@t.local')
    br = await _branch(db_session, owner, 'SAC')
    cv = await _canvas(db_session, br, owner, 'SACC')
    await _add(db_session, "INSERT INTO canvas_member (canvas_id, user_id, role) VALUES (:c,:u,'admin')", c=cv, u=owner)
    fn = f'c{cv}_abc123.png'
    assert await uploads_router._is_authorized('canvas', fn, owner, db_session) is True
    assert await uploads_router._is_authorized('canvas', fn, outsider, db_session) is False


async def test_serve_authz_chat_member_only(db_session):
    owner = await _user(db_session, 'sch1@t.local')
    outsider = await _user(db_session, 'sch2@t.local')
    room = await _room(db_session, owner)
    await _add(db_session, "INSERT INTO chat_room_member (room_id, user_id) VALUES (:r,:u)", r=room, u=owner)
    fn = f'chat_{room}_abc123.png'
    assert await uploads_router._is_authorized('chat', fn, owner, db_session) is True
    assert await uploads_router._is_authorized('chat', fn, outsider, db_session) is False


async def test_serve_authz_public_subdirs(db_session):
    uid = await _user(db_session, 'pub@t.local')
    assert await uploads_router._is_authorized('avatars', 'a.png', uid, db_session) is True
    assert await uploads_router._is_authorized('branch-icons', 'b.svg', uid, db_session) is True
    assert await uploads_router._is_authorized('track-icons', 't.svg', uid, db_session) is True


async def test_serve_authz_unknown_subdir_denied(db_session):
    uid = await _user(db_session, 'unk@t.local')
    assert await uploads_router._is_authorized('etc', 'passwd', uid, db_session) is False


# ── serve_upload HTTP 통합(인증·경로순회·멤버십 엔드투엔드) ────────────────

import contextlib as _ctx
import os as _os

import httpx
import pytest
from httpx import ASGITransport

import db_engine
import main

_UPLOAD_TASK_DIR = _os.path.join(_os.path.dirname(_os.path.dirname(__file__)), 'uploads', 'task')


@pytest.fixture
async def client(db_session, monkeypatch):
    # 미들웨어(transactional_session)와 라우트(db.session) 모두 test 세션을 쓰게 배선
    @_ctx.asynccontextmanager
    async def _fake_txn():
        yield db_session

    async def _override():
        yield db_session

    monkeypatch.setattr(db_engine, "transactional_session", _fake_txn)
    main.app.dependency_overrides[db_engine.session] = _override
    try:
        async with httpx.AsyncClient(transport=ASGITransport(app=main.app), base_url="http://test") as c:
            yield c
    finally:
        main.app.dependency_overrides.pop(db_engine.session, None)


async def _pat(db, user_id, raw):
    from library import crypto
    await db.execute(text("""
        INSERT INTO personal_access_token (user_id, name, token_hash, token_prefix)
        VALUES (:uid, 'r', :h, :p)
    """), {"uid": user_id, "h": crypto.hash_token(raw), "p": raw[:11]})
    return {"Authorization": f"Bearer {raw}"}


async def test_serve_unauthenticated_is_401(client):
    res = await client.get("/api/uploads/avatars/whatever.png")
    assert res.status_code == 401


async def test_serve_member_200_nonmember_and_missing_404(client, db_session):
    owner = await _user(db_session, 'iup-o@t.local')
    outsider = await _user(db_session, 'iup-x@t.local')
    br = await _branch(db_session, owner, 'IUP')
    await _add(db_session, "INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b,:u,'admin')", b=br, u=owner)
    _os.makedirs(_UPLOAD_TASK_DIR, exist_ok=True)
    fn = f't{br}_pytestauthz.png'
    fpath = _os.path.join(_UPLOAD_TASK_DIR, fn)
    with open(fpath, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
    try:
        owner_h = await _pat(db_session, owner, 'wv_authz_owner_tok')
        out_h = await _pat(db_session, outsider, 'wv_authz_outsider_t')
        assert (await client.get(f"/api/uploads/task/{fn}", headers=owner_h)).status_code == 200
        # 비멤버는 미존재와 동일하게 404(존재 오라클 차단)
        assert (await client.get(f"/api/uploads/task/{fn}", headers=out_h)).status_code == 404
        assert (await client.get(f"/api/uploads/task/t{br}_missing.png", headers=owner_h)).status_code == 404
    finally:
        _os.remove(fpath)


async def test_serve_path_traversal_rejected(client, db_session):
    uid = await _user(db_session, 'trav@t.local')
    h = await _pat(db_session, uid, 'wv_traversal_token')
    res = await client.get("/api/uploads/task/%2e%2e%2f%2e%2e%2fmain.py", headers=h)
    assert res.status_code == 404


async def test_svg_served_as_attachment_with_nosniff(client, db_session):
    # SEC-25: SVG는 attachment+nosniff로 서빙(주소창 직접 열람 시 top-level 렌더 XSS 차단)
    uid = await _user(db_session, 'svg@t.local')
    h = await _pat(db_session, uid, 'wv_svg_authz_token')
    icon_dir = _os.path.join(_os.path.dirname(_UPLOAD_TASK_DIR), 'branch-icons')
    _os.makedirs(icon_dir, exist_ok=True)
    fpath = _os.path.join(icon_dir, 'pytesticon.svg')
    with open(fpath, 'wb') as f:
        f.write(b'<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    try:
        r = await client.get('/api/uploads/branch-icons/pytesticon.svg', headers=h)
        assert r.status_code == 200
        assert r.headers.get('content-disposition', '').startswith('attachment')
        assert r.headers.get('x-content-type-options') == 'nosniff'
    finally:
        _os.remove(fpath)


def test_chat_attachment_url_regex_strict():
    # SEC-41: 채팅 첨부 URL은 chat 서브디렉터리 업로드 형식만 허용
    from routers import ws_chat
    R = ws_chat._ATTACHMENT_URL_RE
    assert R.match('/api/uploads/chat/chat_5_abc123.png')
    assert not R.match('//evil.example/api/uploads/chat/x.png')   # protocol-relative
    assert not R.match('/api/uploads/chat/../task/secret.png')    # traversal
    assert not R.match('/api/uploads/task/t1_x.png')              # 비-chat 서브디렉터리
    assert not R.match('https://evil/api/uploads/chat/x.png')     # 절대 URL
    assert not R.match('/api/uploads/chat/')                      # 빈 파일명


async def test_serve_authz_legacy_chat_strict(db_session):
    uid = await _user(db_session, 'leg@t.local')
    # 레거시 chat_{12-hex uuid}.ext(room_id 없음)는 인증 사용자에게 허용(구버전 호환)
    assert await uploads_router._is_authorized('chat', 'chat_0123456789ab.png', uid, db_session) is True
    # chat_로 시작하지만 12-hex uuid 형식이 아니면 거부 — 임의 이름의 멤버십 우회 차단
    assert await uploads_router._is_authorized('chat', 'chat_groupname_x.png', uid, db_session) is False
    assert await uploads_router._is_authorized('chat', 'chat_evil.png', uid, db_session) is False
