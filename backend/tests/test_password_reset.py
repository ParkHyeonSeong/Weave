"""SEC-07: admin reset → 일회용·만료 재설정 토큰/링크 (평문 비밀번호 노출 제거)."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import bcrypt
from sqlalchemy import text

from core.controller import admin as admin_controller
from core.controller import auth as auth_controller
from core.model import password_reset_token as prt_model
from library import crypto


async def _make_user(db, email="reset-user@test.local", password="oldpass123"):
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES (:e, :p, :u, 'active', 'member') RETURNING user_id
    """), {"e": email, "p": pw_hash, "u": "resetuser"})
    return row.scalar_one()


async def _make_admin(db, email="reset-admin@test.local"):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES (:e, :p, :u, 'active', 'admin') RETURNING user_id
    """), {"e": email, "p": b"x", "u": "resetadmin"})
    return row.scalar_one()


def _req(user_id):
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id}))


def _reset_body(token, new_password):
    return SimpleNamespace(token=token, new_password=new_password)


# ── admin reset: 평문 비밀번호 노출 제거 ───────────────────────────────────

async def test_admin_reset_returns_no_plaintext_password(db_session):
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session)
    body = SimpleNamespace(new_password=None)
    res = await admin_controller.reset_user_password(uid, body, _req(admin_id), db_session)
    assert res["status"] is True
    # 평문 비밀번호 필드는 응답에서 완전히 사라져야 한다
    assert "temporary_password" not in res
    # SMTP 미설정이므로 reset_token(원문) 또는 reset_link가 관리자에게 반환된다
    assert ("reset_token" in res) or ("reset_link" in res)


async def test_admin_reset_stores_hash_not_plaintext(db_session):
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session)
    body = SimpleNamespace(new_password=None)
    res = await admin_controller.reset_user_password(uid, body, _req(admin_id), db_session)
    raw = res["reset_token"]
    row = await db_session.execute(text("""
        SELECT token_hash, user_id, used_at FROM password_reset_token WHERE user_id = :uid
    """), {"uid": uid})
    rec = row.fetchone()
    assert rec is not None
    # 평문이 아니라 해시로 저장되어야 한다
    assert rec.token_hash != raw
    assert rec.token_hash == crypto.hash_token(raw)
    assert rec.used_at is None


async def test_admin_cannot_reset_own_password(db_session):
    admin_id = await _make_admin(db_session)
    body = SimpleNamespace(new_password=None)
    res = await admin_controller.reset_user_password(admin_id, body, _req(admin_id), db_session)
    assert res["status"] is False
    assert res["message"] == "CANNOT_RESET_OWN_PASSWORD"


# ── 소비: 유효 토큰으로 새 비번 설정 ───────────────────────────────────────

async def test_consume_valid_token_changes_password(db_session):
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session, email="consume@test.local")
    reset = await admin_controller.reset_user_password(
        uid, SimpleNamespace(new_password=None), _req(admin_id), db_session)
    raw = reset["reset_token"]

    out = await auth_controller.reset_password(_reset_body(raw, "brandnew99"), db_session)
    assert out["status"] is True

    # 비밀번호가 실제로 변경되어 로그인 가능해야 한다
    user = await db_session.execute(
        text('SELECT password FROM "user" WHERE user_id = :uid'), {"uid": uid})
    stored = user.scalar_one()
    if isinstance(stored, memoryview):
        stored = bytes(stored)
    assert bcrypt.checkpw(b"brandnew99", stored)
    assert not bcrypt.checkpw(b"oldpass123", stored)

    # 토큰이 used 처리되어야 한다
    rec = await db_session.execute(
        text("SELECT used_at FROM password_reset_token WHERE user_id = :uid"), {"uid": uid})
    assert rec.scalar_one() is not None


async def test_consume_single_use_rejects_reuse(db_session):
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session, email="reuse@test.local")
    reset = await admin_controller.reset_user_password(
        uid, SimpleNamespace(new_password=None), _req(admin_id), db_session)
    raw = reset["reset_token"]

    first = await auth_controller.reset_password(_reset_body(raw, "firstpass1"), db_session)
    assert first["status"] is True
    second = await auth_controller.reset_password(_reset_body(raw, "secondpass2"), db_session)
    assert second["status"] is False
    assert second["message"] == "INVALID_OR_EXPIRED_TOKEN"


async def test_consume_expired_token_rejected(db_session):
    uid = await _make_user(db_session, email="expired@test.local")
    raw = "rst_" + "expiredtokenvalue"
    token_hash = crypto.hash_token(raw)
    expired = datetime.now(timezone.utc) - timedelta(hours=1)
    await prt_model.create(token_hash, uid, expired, db_session)

    out = await auth_controller.reset_password(_reset_body(raw, "whatever12"), db_session)
    assert out["status"] is False
    assert out["message"] == "INVALID_OR_EXPIRED_TOKEN"


async def test_consume_unknown_token_rejected(db_session):
    out = await auth_controller.reset_password(
        _reset_body("rst_does_not_exist", "whatever12"), db_session)
    assert out["status"] is False
    assert out["message"] == "INVALID_OR_EXPIRED_TOKEN"


async def test_consume_weak_password_rejected(db_session):
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session, email="weak@test.local")
    reset = await admin_controller.reset_user_password(
        uid, SimpleNamespace(new_password=None), _req(admin_id), db_session)
    raw = reset["reset_token"]

    out = await auth_controller.reset_password(_reset_body(raw, "12345"), db_session)
    assert out["status"] is False
    assert out["message"] == "PASSWORD_TOO_SHORT"
    # 약한 비번 거부 시 토큰은 소비되지 않아야 한다
    rec = await db_session.execute(
        text("SELECT used_at FROM password_reset_token WHERE user_id = :uid"), {"uid": uid})
    assert rec.scalar_one() is None
