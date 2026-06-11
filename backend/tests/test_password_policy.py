"""SEC-10: 비밀번호 정책 강화 — 최소 길이 8자 + bcrypt cost=12 중앙화(crypto.hash_password).

- 길이 검증이 모든 경로(스키마 검증부 + register/reset 컨트롤러)에서 8자로 통일됐는지
- 신규 해시가 cost=12(`$2b$12$`)인지, 기존 cost=10 해시는 여전히 검증되는지(호환성)
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import bcrypt
import pytest
from pydantic import ValidationError
from sqlalchemy import text

from core.controller import auth as auth_controller
from core.model import password_reset_token as prt_model
from library import crypto
from routers.schema import admin as admin_schema
from routers.schema import profile as profile_schema
from routers.schema import setup as setup_schema


# ── crypto.hash_password: cost=12 + 호환성 ─────────────────────────────────

def test_min_password_length_is_8():
    assert crypto.MIN_PASSWORD_LENGTH == 8


def test_hash_password_uses_cost_12():
    h = crypto.hash_password("correcthorse")
    # bcrypt 해시는 `$2b$<cost>$...` 형식 — cost 세그먼트가 12여야 한다
    assert h.decode().split("$")[2] == "12"


def test_hash_password_roundtrip():
    h = crypto.hash_password("correcthorse")
    assert bcrypt.checkpw(b"correcthorse", h)
    assert not bcrypt.checkpw(b"wrongpassword", h)


def test_legacy_cost10_hash_still_verifies():
    # cost를 올려도 기존 cost=10 해시는 embed된 cost로 그대로 검증돼야 한다(무중단 호환).
    legacy = bcrypt.hashpw(b"correcthorse", bcrypt.gensalt(rounds=10))
    assert legacy.decode().split("$")[2] == "10"
    assert bcrypt.checkpw(b"correcthorse", legacy)


# ── 스키마 검증부: < 8 거부, >= 8 허용 ─────────────────────────────────────

def test_create_user_schema_rejects_short():
    with pytest.raises(ValidationError):
        admin_schema.CreateUser(email="a@b.c", username="u", password="seven77")  # 7자


def test_create_user_schema_accepts_eight():
    m = admin_schema.CreateUser(email="a@b.c", username="u", password="eight888")  # 8자
    assert m.password == "eight888"


def test_update_password_schema_rejects_short():
    with pytest.raises(ValidationError):
        profile_schema.UpdatePassword(
            current_password="x", new_password="seven77", confirm_password="seven77")


def test_update_password_schema_accepts_eight():
    m = profile_schema.UpdatePassword(
        current_password="x", new_password="eight888", confirm_password="eight888")
    assert m.new_password == "eight888"


def test_force_change_password_schema_rejects_short():
    with pytest.raises(ValidationError):
        profile_schema.ForceChangePassword(new_password="seven77", confirm_password="seven77")


def test_force_change_password_schema_accepts_eight():
    m = profile_schema.ForceChangePassword(new_password="eight888", confirm_password="eight888")
    assert m.new_password == "eight888"


def test_setup_initialize_schema_rejects_short():
    # 최초 관리자 생성(setup)도 서버측에서 정책을 강제해야 한다(우회 차단).
    with pytest.raises(ValidationError):
        setup_schema.SetupInitialize(
            workspace_name="W", registration_policy="private",
            email="a@b.c", password="seven77", username="admin")  # 7자


def test_setup_initialize_schema_accepts_eight():
    m = setup_schema.SetupInitialize(
        workspace_name="W", registration_policy="private",
        email="a@b.c", password="eight888", username="admin")
    assert m.password == "eight888"


# ── register 컨트롤러: 길이 게이트가 이메일 로직보다 먼저 ──────────────────

def _register_body(password):
    return SimpleNamespace(email="newcomer@test.local", password=password, username="newcomer")


async def test_register_rejects_short_password(db_session):
    res = await auth_controller.register(
        _register_body("seven77"), None, None, db_session)  # 7자
    assert res["status"] is False
    assert res["message"] == "PASSWORD_TOO_SHORT"


async def test_register_eight_passes_length_gate(db_session):
    # 8자는 길이 게이트를 통과한다 — 테스트 DB엔 워크스페이스 설정이 없어 NOT_INITIALIZED가
    # 돌아오지만, 핵심은 PASSWORD_TOO_SHORT가 아니라는 점(게이트 통과 + 순서 검증).
    res = await auth_controller.register(
        _register_body("eight888"), None, None, db_session)
    assert res["message"] != "PASSWORD_TOO_SHORT"


# ── reset 소비 컨트롤러: < 8 거부(토큰 미소비), >= 8 허용 ──────────────────

async def _seed_user_with_token(db, email, expires_delta=timedelta(hours=1)):
    pw_hash = bcrypt.hashpw(b"oldpass123", bcrypt.gensalt())
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES (:e, :p, :u, 'active', 'member') RETURNING user_id
    """), {"e": email, "p": pw_hash, "u": "pwpolicy"})
    uid = row.scalar_one()
    raw = "rst_" + email.replace("@", "_").replace(".", "_")
    expires = datetime.now(timezone.utc) + expires_delta
    await prt_model.create(crypto.hash_token(raw), uid, expires, db)
    return uid, raw


async def test_reset_rejects_short_password_without_consuming(db_session):
    uid, raw = await _seed_user_with_token(db_session, "reset-short@test.local")
    out = await auth_controller.reset_password(
        SimpleNamespace(token=raw, new_password="seven77"), db_session)  # 7자
    assert out["status"] is False
    assert out["message"] == "PASSWORD_TOO_SHORT"
    # 약한 비번 거부 시 토큰은 소비되지 않아야 한다(재시도 가능)
    rec = await db_session.execute(
        text("SELECT used_at FROM password_reset_token WHERE user_id = :uid"), {"uid": uid})
    assert rec.scalar_one() is None


async def test_reset_accepts_eight_and_uses_cost12(db_session):
    uid, raw = await _seed_user_with_token(db_session, "reset-ok@test.local")
    out = await auth_controller.reset_password(
        SimpleNamespace(token=raw, new_password="eight888"), db_session)
    assert out["status"] is True
    stored = await db_session.execute(
        text('SELECT password FROM "user" WHERE user_id = :uid'), {"uid": uid})
    h = stored.scalar_one()
    if isinstance(h, memoryview):
        h = bytes(h)
    # 새 해시는 cost=12, 새 비번으로 검증돼야 한다
    assert h.decode().split("$")[2] == "12"
    assert bcrypt.checkpw(b"eight888", h)
