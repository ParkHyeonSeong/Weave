from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import pat as pat_controller
from library import crypto


async def _make_user(db, email="ctrl-user@test.local"):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": "ctrluser"})
    return row.scalar_one()


def _req(user_id):
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id}))


async def test_create_token_returns_raw_once_and_stores_hash(db_session):
    uid = await _make_user(db_session)
    body = SimpleNamespace(name="MCP", expires_in_days=None)
    res = await pat_controller.create_token(body, _req(uid), db_session)
    assert res["status"] is True
    raw = res["token"]
    assert raw.startswith("wv_")
    stored = await db_session.execute(
        text("SELECT token_hash, token_prefix FROM personal_access_token WHERE pat_id = :id"),
        {"id": res["pat"]["pat_id"]},
    )
    row = stored.fetchone()
    assert row.token_hash == crypto.hash_token(raw)
    assert raw.startswith(row.token_prefix)


async def test_create_token_sets_expiry(db_session):
    uid = await _make_user(db_session)
    body = SimpleNamespace(name="ci", expires_in_days=30)
    res = await pat_controller.create_token(body, _req(uid), db_session)
    row = await db_session.execute(
        text("SELECT expires_at FROM personal_access_token WHERE pat_id = :id"),
        {"id": res["pat"]["pat_id"]},
    )
    assert row.scalar_one() is not None


async def test_authenticate_token_valid(db_session):
    uid = await _make_user(db_session)
    res = await pat_controller.create_token(SimpleNamespace(name="t", expires_in_days=None),
                                            _req(uid), db_session)
    payload = await pat_controller.authenticate_token(res["token"], db_session)
    assert payload is not None
    assert payload["user_id"] == uid
    assert payload["role"] == "member"


async def test_authenticate_token_invalid_returns_none(db_session):
    assert await pat_controller.authenticate_token("wv_not_a_real_token", db_session) is None


async def test_authenticate_token_revoked_returns_none(db_session):
    uid = await _make_user(db_session)
    res = await pat_controller.create_token(SimpleNamespace(name="t", expires_in_days=None),
                                            _req(uid), db_session)
    await pat_controller.revoke_token(res["pat"]["pat_id"], _req(uid), db_session)
    assert await pat_controller.authenticate_token(res["token"], db_session) is None


async def test_list_tokens_excludes_hash(db_session):
    uid = await _make_user(db_session)
    await pat_controller.create_token(SimpleNamespace(name="t", expires_in_days=None),
                                      _req(uid), db_session)
    res = await pat_controller.list_tokens(_req(uid), db_session)
    assert res["status"] is True
    assert len(res["tokens"]) == 1
    assert "token_hash" not in res["tokens"][0]


async def test_revoke_token_not_owner_returns_false(db_session):
    owner = await _make_user(db_session, "o2@test.local")
    other = await _make_user(db_session, "x2@test.local")
    res = await pat_controller.create_token(SimpleNamespace(name="t", expires_in_days=None),
                                            _req(owner), db_session)
    out = await pat_controller.revoke_token(res["pat"]["pat_id"], _req(other), db_session)
    assert out["status"] is False
