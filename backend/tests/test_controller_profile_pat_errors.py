"""profile + pat 컨트롤러 실패 반환 → 통합 에러 엔벨로프 검증.

마이그레이션: {'status': False, 'message': 'X'} → error_response(ErrorCode.X)
검증: status is False / code == message (dual-emit) / category / retryable.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import bcrypt
from sqlalchemy import text

from core.controller import pat as pat_controller
from core.controller import profile as profile_controller


def _assert_error(res, code, category, retryable=False):
    assert res["status"] is False
    assert res["code"] == code
    assert res["category"] == category
    assert res["message"] == res["code"]          # dual-emit
    assert res["retryable"] is retryable


def _req(user_id):
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id}))


async def _make_user(db, email="prof-test@test.local", password="testpass99",
                     must_change=False):
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES (:e, :p, :u, 'active', 'member') RETURNING user_id
    """), {"e": email, "p": pw_hash, "u": "proftest"})
    uid = row.scalar_one()
    if must_change:
        await db.execute(
            text('UPDATE "user" SET must_change_password = TRUE WHERE user_id = :uid'),
            {"uid": uid},
        )
    return uid


# ── not_found: USER_NOT_FOUND ─────────────────────────────────────────────────

async def test_get_profile_unknown_user_returns_user_not_found(db_session):
    res = await profile_controller.get_profile(_req(999999999), db_session)
    _assert_error(res, "USER_NOT_FOUND", "not_found")


# ── validation: INVALID_CURRENT_PASSWORD ─────────────────────────────────────

async def test_update_password_wrong_current_returns_invalid_current_password(db_session):
    uid = await _make_user(db_session, "wrong-pw@test.local", password="correct99")
    body = SimpleNamespace(
        current_password="wrong_password",
        new_password="newpass99",
        confirm_password="newpass99",
    )
    res = await profile_controller.update_password(body, _req(uid), db_session)
    _assert_error(res, "INVALID_CURRENT_PASSWORD", "validation")


# ── validation: PASSWORD_MISMATCH ────────────────────────────────────────────

async def test_update_password_confirm_mismatch_returns_password_mismatch(db_session):
    uid = await _make_user(db_session, "mismatch@test.local", password="correct99")
    body = SimpleNamespace(
        current_password="correct99",
        new_password="newpass99",
        confirm_password="different99",
    )
    res = await profile_controller.update_password(body, _req(uid), db_session)
    _assert_error(res, "PASSWORD_MISMATCH", "validation")


# ── forbidden: NOT_ALLOWED (must_change_password=False) ──────────────────────

async def test_force_change_password_without_flag_returns_not_allowed(db_session):
    uid = await _make_user(db_session, "no-flag@test.local", must_change=False)
    body = SimpleNamespace(new_password="newpass99", confirm_password="newpass99")
    res = await profile_controller.force_change_password(body, _req(uid), db_session)
    _assert_error(res, "NOT_ALLOWED", "forbidden")


# ── validation: NO_FILE (upload guard chain, before file.read()) ─────────────

async def test_upload_avatar_no_file_returns_no_file(db_session):
    uid = await _make_user(db_session, "no-file@test.local")
    fake_file = SimpleNamespace(filename="", read=AsyncMock(return_value=b""))
    res = await profile_controller.upload_avatar(fake_file, _req(uid), db_session)
    _assert_error(res, "NO_FILE", "validation")


# ── not_found: TOKEN_NOT_FOUND (pat controller) ───────────────────────────────

async def test_revoke_nonexistent_token_returns_token_not_found(db_session):
    uid = await _make_user(db_session, "pat-revoke@test.local")
    res = await pat_controller.revoke_token(999999999, _req(uid), db_session)
    _assert_error(res, "TOKEN_NOT_FOUND", "not_found")
