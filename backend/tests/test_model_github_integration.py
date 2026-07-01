"""Model tests for github_integration (branch<->repo mapping).

Style: direct model calls, raw-INSERT seed via the rollback-isolated db_session
fixture (same pattern as test_idor_ref_status.py).
"""
from sqlalchemy import text

from core.model import github_integration as ghi


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="B", key="GHI1"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    return row.scalar_one()


async def test_create_and_find_by_branch(db_session):
    u = await _make_user(db_session, "ghi_a@gh.test", "ghi_a")
    b = await _make_branch(db_session, u, key="GHIA")
    created = await ghi.create(b, "org/repo", 12345, u, db_session)
    assert created["repo_full_name"] == "org/repo"
    assert created["installation_id"] == 12345
    assert created["enabled"] is True
    assert created["branch_id"] == b

    rows = await ghi.find_by_branch(b, db_session)
    assert [r["integration_id"] for r in rows] == [created["integration_id"]]


async def test_find_enabled_and_active_for_repo(db_session):
    u = await _make_user(db_session, "ghi_b@gh.test", "ghi_b")
    b = await _make_branch(db_session, u, key="GHIB")
    created = await ghi.create(b, "org/repo2", 222, u, db_session)

    found = await ghi.find_enabled(b, "org/repo2", db_session)
    assert found is not None and found["integration_id"] == created["integration_id"]
    # case-insensitive repo match (GitHub repo names are case-insensitive)
    assert await ghi.find_enabled(b, "ORG/REPO2", db_session) is not None

    active = await ghi.find_active_for_repo("org/repo2", db_session)
    assert created["integration_id"] in [r["integration_id"] for r in active]


async def test_set_enabled_toggles_and_is_branch_scoped(db_session):
    u = await _make_user(db_session, "ghi_c@gh.test", "ghi_c")
    b = await _make_branch(db_session, u, key="GHIC")
    other = await _make_branch(db_session, u, name="O", key="GHIO")
    created = await ghi.create(b, "org/repo3", 333, u, db_session)

    toggled = await ghi.set_enabled(created["integration_id"], b, False, db_session)
    assert toggled is not None and toggled["enabled"] is False
    # disabled rows are excluded from find_enabled and find_active_for_repo
    assert await ghi.find_enabled(b, "org/repo3", db_session) is None
    assert await ghi.find_active_for_repo("org/repo3", db_session) == []

    # cross-branch set_enabled is a no-op (returns None, row untouched)
    assert await ghi.set_enabled(created["integration_id"], other, True, db_session) is None


async def test_delete_is_tuple_scoped(db_session):
    u = await _make_user(db_session, "ghi_d@gh.test", "ghi_d")
    b = await _make_branch(db_session, u, key="GHID")
    other = await _make_branch(db_session, u, name="O", key="GHID2")
    created = await ghi.create(b, "org/repo4", 444, u, db_session)

    # wrong branch -> no delete, returns None, row survives
    assert await ghi.delete(created["integration_id"], other, db_session) is None
    assert await ghi.find_by_branch(b, db_session) != []

    # correct branch -> deletes, returns the id
    assert await ghi.delete(created["integration_id"], b, db_session) == created["integration_id"]
    assert await ghi.find_by_branch(b, db_session) == []
