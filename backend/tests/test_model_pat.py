from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from core.model import pat as pat_model


async def _make_user(db, email="pat-user@test.local"):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": "patuser"})
    return row.scalar_one()


async def test_create_and_find_active(db_session):
    uid = await _make_user(db_session)
    pat_id = await pat_model.create(uid, "tok", "hash_aaa", "wv_aaaaaaaa", None, db_session)
    assert isinstance(pat_id, int)
    found = await pat_model.find_active_by_hash("hash_aaa", db_session)
    assert found is not None
    assert found["user_id"] == uid
    assert found["email"] == "pat-user@test.local"
    assert found["username"] == "patuser"
    assert found["role"] == "member"


async def test_find_active_excludes_revoked(db_session):
    uid = await _make_user(db_session)
    pat_id = await pat_model.create(uid, "tok", "hash_rev", "wv_rev", None, db_session)
    await pat_model.revoke(pat_id, uid, db_session)
    assert await pat_model.find_active_by_hash("hash_rev", db_session) is None


async def test_find_active_excludes_expired(db_session):
    uid = await _make_user(db_session)
    past = datetime.now(timezone.utc) - timedelta(days=1)
    await pat_model.create(uid, "tok", "hash_exp", "wv_exp", past, db_session)
    assert await pat_model.find_active_by_hash("hash_exp", db_session) is None


async def test_list_for_user_excludes_hash(db_session):
    uid = await _make_user(db_session)
    await pat_model.create(uid, "tok1", "hash_l1", "wv_l1", None, db_session)
    rows = await pat_model.list_for_user(uid, db_session)
    assert len(rows) == 1
    assert "token_hash" not in rows[0]
    assert rows[0]["name"] == "tok1"
    assert rows[0]["token_prefix"] == "wv_l1"


async def test_revoke_is_owner_scoped(db_session):
    owner = await _make_user(db_session, "owner@test.local")
    other = await _make_user(db_session, "other@test.local")
    pat_id = await pat_model.create(owner, "tok", "hash_own", "wv_own", None, db_session)
    assert await pat_model.revoke(pat_id, other, db_session) is False  # not the owner
    assert await pat_model.find_active_by_hash("hash_own", db_session) is not None
    assert await pat_model.revoke(pat_id, owner, db_session) is True


async def test_touch_last_used_sets_timestamp(db_session):
    uid = await _make_user(db_session)
    pat_id = await pat_model.create(uid, "tok", "hash_touch", "wv_t", None, db_session)
    await pat_model.touch_last_used(pat_id, db_session)
    row = await db_session.execute(
        text("SELECT last_used_at FROM personal_access_token WHERE pat_id = :id"),
        {"id": pat_id},
    )
    assert row.scalar_one() is not None


async def test_list_for_user_excludes_revoked(db_session):
    uid = await _make_user(db_session)
    await pat_model.create(uid, "keep", "hash_keep", "wv_keep", None, db_session)
    drop = await pat_model.create(uid, "drop", "hash_drop", "wv_drop", None, db_session)
    await pat_model.revoke(drop, uid, db_session)
    names = [r["name"] for r in await pat_model.list_for_user(uid, db_session)]
    assert "keep" in names
    assert "drop" not in names
