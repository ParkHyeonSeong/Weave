"""SEC-29: 단기 access + 폐기 가능한 refresh 토큰.

- 모델: 해시 저장/조회·만료 필터·폐기(단일/전체).
- 컨트롤러: 로그인 시 refresh 발급, refresh로 회전 발급, 로그아웃·비번재설정으로 폐기.
"""
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace

import bcrypt
import pytest
from fastapi import Response
from sqlalchemy import text

from core.controller import auth as auth_ctrl
from core.model import refresh_token as rt_model
from config import REFRESH_COOKIE_NAME
from library import crypto
from library.validator import UnAuthorizedException

_FUTURE = datetime.now(timezone.utc) + timedelta(days=7)
_PAST = datetime.now(timezone.utc) - timedelta(days=1)


async def _user(db, email, password="correctpass1", status="active"):
    pw = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES (:e, :p, 'u', :s, 'member') RETURNING user_id
    """), {"e": email, "p": pw, "s": status})
    return row.scalar_one()


async def _count(db, uid):
    return (await db.execute(text(
        "SELECT COUNT(*) FROM refresh_token WHERE user_id=:u"), {"u": uid})).scalar_one()


# ── 모델 ───────────────────────────────────────────────────────────────────

async def test_create_find_delete(db_session):
    uid = await _user(db_session, "rt1@t.local")
    h = crypto.hash_token("rawtok1")
    await rt_model.create(uid, h, _FUTURE, db_session)
    row = await rt_model.find_active_by_hash(h, db_session)
    assert row and row['user_id'] == uid
    await rt_model.delete_by_hash(h, db_session)
    assert await rt_model.find_active_by_hash(h, db_session) is None


async def test_expired_not_active(db_session):
    uid = await _user(db_session, "rt2@t.local")
    h = crypto.hash_token("rawtok2")
    await rt_model.create(uid, h, _PAST, db_session)
    assert await rt_model.find_active_by_hash(h, db_session) is None


async def test_delete_all_for_user(db_session):
    uid = await _user(db_session, "rt3@t.local")
    for r in ("a", "b", "c"):
        await rt_model.create(uid, crypto.hash_token(r), _FUTURE, db_session)
    assert await _count(db_session, uid) == 3
    await rt_model.delete_all_for_user(uid, db_session)
    assert await _count(db_session, uid) == 0


# ── 컨트롤러 ─────────────────────────────────────────────────────────────────

def _login_req():
    return SimpleNamespace(headers={}, client=SimpleNamespace(host="127.0.0.1"))


async def test_login_issues_refresh_token(db_session):
    uid = await _user(db_session, "rtlogin@t.local")
    body = SimpleNamespace(email="rtlogin@t.local", password="correctpass1")
    res = await auth_ctrl.login(body, _login_req(), Response(), db_session)
    assert res["status"] is True
    assert await _count(db_session, uid) == 1  # 로그인 시 refresh 토큰 1개 발급


async def test_refresh_rotates_and_issues(db_session):
    uid = await _user(db_session, "rtrot@t.local")
    raw = "rotate_raw_token"
    await rt_model.create(uid, crypto.hash_token(raw), _FUTURE, db_session)
    req = SimpleNamespace(cookies={REFRESH_COOKIE_NAME: raw})
    res = await auth_ctrl.refresh(req, Response(), db_session)
    assert res["status"] is True
    # 회전: 사용한 토큰은 폐기되고 새 토큰이 생김(개수 1 유지, 기존 해시는 무효)
    assert await rt_model.find_active_by_hash(crypto.hash_token(raw), db_session) is None
    assert await _count(db_session, uid) == 1


async def test_refresh_rejects_revoked(db_session):
    req = SimpleNamespace(cookies={REFRESH_COOKIE_NAME: "nonexistent_raw"})
    with pytest.raises(UnAuthorizedException):
        await auth_ctrl.refresh(req, Response(), db_session)


async def test_logout_revokes_refresh(db_session):
    uid = await _user(db_session, "rtout@t.local")
    raw = "logout_raw_token"
    await rt_model.create(uid, crypto.hash_token(raw), _FUTURE, db_session)
    req = SimpleNamespace(cookies={REFRESH_COOKIE_NAME: raw})
    await auth_ctrl.logout(req, Response(), db_session)
    assert await rt_model.find_active_by_hash(crypto.hash_token(raw), db_session) is None
