import contextlib

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import text

import db_engine
import main


@pytest.fixture
async def client(db_session, monkeypatch):
    """ASGI client wired so BOTH the auth middleware and route handlers use the test
    session (rolled back after the test):
    - middleware calls db.transactional_session() → monkeypatched to yield db_session
    - route handlers depend on db.session → overridden to yield db_session
    So rows created in a test are visible across middleware+routes and undone on rollback.
    """
    @contextlib.asynccontextmanager
    async def _fake_txn_session():
        yield db_session

    async def _override_session():
        yield db_session  # no commit — db_session fixture owns the transaction/rollback

    monkeypatch.setattr(db_engine, "transactional_session", _fake_txn_session)
    main.app.dependency_overrides[db_engine.session] = _override_session
    try:
        transport = ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c
    finally:
        main.app.dependency_overrides.pop(db_engine.session, None)


async def _seed_user(db, email="route-user@test.local"):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": "routeuser"})
    return row.scalar_one()


async def _make_token(db, user_id, raw="wv_route_raw_token"):
    from library import crypto
    await db.execute(text("""
        INSERT INTO personal_access_token (user_id, name, token_hash, token_prefix)
        VALUES (:uid, 'r', :h, :p)
    """), {"uid": user_id, "h": crypto.hash_token(raw), "p": raw[:11]})
    return raw


async def test_bearer_token_authenticates_protected_route(client, db_session):
    uid = await _seed_user(db_session)
    raw = await _make_token(db_session, uid)
    res = await client.get("/api/profile/me", headers={"Authorization": f"Bearer {raw}"})
    assert res.status_code == 200


async def test_invalid_bearer_token_is_401(client):
    res = await client.get("/api/profile/me", headers={"Authorization": "Bearer wv_bogus"})
    assert res.status_code == 401


async def test_no_auth_is_401(client):
    res = await client.get("/api/profile/me")
    assert res.status_code == 401


async def test_create_list_revoke_via_bearer(client, db_session):
    uid = await _seed_user(db_session, "crud@test.local")
    raw = await _make_token(db_session, uid, "wv_crud_admin_token")
    headers = {"Authorization": f"Bearer {raw}"}

    created = await client.post("/api/profile/tokens", json={"name": "new"}, headers=headers)
    assert created.status_code == 200
    body = created.json()
    assert body["status"] is True
    assert body["token"].startswith("wv_")
    new_id = body["pat"]["pat_id"]

    listed = await client.get("/api/profile/tokens", headers=headers)
    names = [t["name"] for t in listed.json()["tokens"]]
    assert "new" in names

    revoked = await client.delete(f"/api/profile/tokens/{new_id}", headers=headers)
    assert revoked.status_code == 200
    assert revoked.json()["status"] is True


async def test_expired_bearer_token_is_401(client, db_session):
    from datetime import datetime, timedelta, timezone
    from library import crypto
    uid = await _seed_user(db_session, "expired-route@test.local")
    raw = "wv_expired_route_token"
    past = datetime.now(timezone.utc) - timedelta(days=1)
    await db_session.execute(text("""
        INSERT INTO personal_access_token (user_id, name, token_hash, token_prefix, expires_at)
        VALUES (:uid, 'exp', :h, :p, :exp)
    """), {"uid": uid, "h": crypto.hash_token(raw), "p": raw[:11], "exp": past})
    res = await client.get("/api/profile/me", headers={"Authorization": f"Bearer {raw}"})
    assert res.status_code == 401
