"""Regression tests for migration 062 (backfill repo_full_name to lowercase).

Migration 062 runs once at the session-scoped `alembic upgrade head` fixture
(see conftest.py: migrated_test_db), BEFORE any test body executes. That means
we cannot re-run the migration itself against freshly-seeded mixed-case rows
within a test — the migration already ran (as a no-op, since this dev/test DB
only ever had lowercase rows) before we get a db_session.

Instead, these tests exercise the exact SQL statements the migration runs,
directly on the rollback-isolated db_session fixture: raw-INSERT mixed-case
rows (bypassing the model normalization added in 73d2ae6), execute the SAME
UPDATE/SELECT SQL the migration uses, and assert the outcome. This is the
honest testable boundary for a data migration that runs under a session-scoped
upgrade fixture — it proves the backfill SQL and the fail-fast collision
detector both do what migration 062 depends on.

Style: raw-INSERT seed via db_session, mirrors test_github_dispatch_e2e.py's
_make_user/_make_branch/_make_task helpers.
"""
from sqlalchemy import text


# --- seed helpers (raw INSERT — real schema column names) -----------------
async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Branch", key="MIGB"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    return row.scalar_one()


async def _make_task(db, branch_id, created_by, title="Task"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, 'in_progress', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "u": created_by})
    return res.scalar_one()


async def _make_integration(db, branch_id, repo, installation_id, created_by):
    row = await db.execute(text("""
        INSERT INTO github_integration (branch_id, repo_full_name, installation_id, created_by)
        VALUES (:b, :r, :i, :u) RETURNING integration_id
    """), {"b": branch_id, "r": repo, "i": installation_id, "u": created_by})
    return row.scalar_one()


async def _make_ref(db, task_id, repo, ref_type, html_url, ref_number=None, sha=None):
    row = await db.execute(text("""
        INSERT INTO task_github_ref (task_id, repo_full_name, ref_type, ref_number, sha, html_url)
        VALUES (:t, :r, :rt, :n, :s, :u) RETURNING ref_id
    """), {"t": task_id, "r": repo, "rt": ref_type, "n": ref_number, "s": sha, "u": html_url})
    return row.scalar_one()


# --- migration SQL under test (kept byte-for-byte identical to 062) --------
_UPDATE_INTEGRATION_SQL = """
    UPDATE github_integration
    SET repo_full_name = LOWER(repo_full_name)
    WHERE repo_full_name <> LOWER(repo_full_name)
"""

_UPDATE_REF_SQL = """
    UPDATE task_github_ref
    SET repo_full_name = LOWER(repo_full_name)
    WHERE repo_full_name <> LOWER(repo_full_name)
"""

_INTEGRATION_COLLISION_SQL = """
    SELECT branch_id, LOWER(repo_full_name) AS norm, COUNT(*) AS cnt
    FROM github_integration
    GROUP BY branch_id, LOWER(repo_full_name)
    HAVING COUNT(*) > 1
"""


async def test_backfill_lowercases_mixed_case_integration(db_session):
    u = await _make_user(db_session, "mig_int@gh.test", "mig_int")
    b = await _make_branch(db_session, u, key="MIGI")
    integration_id = await _make_integration(db_session, b, "Org/Repo", 111, u)

    await db_session.execute(text(_UPDATE_INTEGRATION_SQL))

    row = await db_session.execute(text(
        "SELECT repo_full_name FROM github_integration WHERE integration_id = :i"
    ), {"i": integration_id})
    assert row.scalar_one() == "org/repo"


async def test_backfill_lowercases_mixed_case_ref(db_session):
    u = await _make_user(db_session, "mig_ref@gh.test", "mig_ref")
    b = await _make_branch(db_session, u, key="MIGR")
    t = await _make_task(db_session, b, u)
    ref_id = await _make_ref(
        db_session, t, "Org/Repo", "pull_request",
        "https://github.com/Org/Repo/pull/1", ref_number=1,
    )

    await db_session.execute(text(_UPDATE_REF_SQL))

    row = await db_session.execute(text(
        "SELECT repo_full_name FROM task_github_ref WHERE ref_id = :i"
    ), {"i": ref_id})
    assert row.scalar_one() == "org/repo"


async def test_collision_group_is_detected(db_session):
    u = await _make_user(db_session, "mig_col@gh.test", "mig_col")
    b = await _make_branch(db_session, u, key="MIGC")
    # both succeed under the case-sensitive UNIQUE (branch_id, repo_full_name)
    await _make_integration(db_session, b, "Org/Repo", 111, u)
    await _make_integration(db_session, b, "org/repo", 112, u)

    rows = (await db_session.execute(text(_INTEGRATION_COLLISION_SQL))).fetchall()

    matching = [r for r in rows if r.branch_id == b]
    assert len(matching) == 1
    assert matching[0].norm == "org/repo"
    assert matching[0].cnt == 2
