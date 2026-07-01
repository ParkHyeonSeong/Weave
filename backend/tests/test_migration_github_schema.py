"""SLICE 0: migrations 058-061 schema smoke tests.

The session-scoped `migrated_test_db` fixture runs `alembic upgrade head`, so by
the time `db_session` is available all new tables/columns must exist. We assert
via to_regclass (table presence) and information_schema (columns / constraints),
matching tests/test_smoke.py.
"""
from sqlalchemy import text


async def _columns(db, table):
    rows = await db.execute(text("""
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = :t
    """), {"t": table})
    return {r.column_name: r for r in rows.fetchall()}


async def test_github_integration_table_exists(db_session):
    reg = await db_session.execute(text("SELECT to_regclass('public.github_integration')"))
    assert reg.scalar_one() is not None


async def test_github_integration_columns(db_session):
    cols = await _columns(db_session, "github_integration")
    assert "integration_id" in cols
    assert cols["repo_full_name"].is_nullable == "NO"
    assert cols["installation_id"].data_type == "bigint"
    assert cols["enabled"].data_type == "boolean"
    assert cols["enabled"].is_nullable == "NO"
    assert cols["created_at"].data_type == "timestamp with time zone"


async def test_github_integration_unique_branch_repo(db_session):
    rows = await db_session.execute(text("""
        SELECT 1
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_name = 'github_integration'
          AND tc.constraint_type = 'UNIQUE'
          AND ccu.column_name IN ('branch_id', 'repo_full_name')
    """))
    assert len(rows.fetchall()) >= 2


async def test_task_github_ref_table_exists(db_session):
    reg = await db_session.execute(text("SELECT to_regclass('public.task_github_ref')"))
    assert reg.scalar_one() is not None


async def test_task_github_ref_columns(db_session):
    cols = await _columns(db_session, "task_github_ref")
    assert "ref_id" in cols
    assert cols["task_id"].is_nullable == "NO"
    assert cols["repo_full_name"].is_nullable == "NO"
    assert cols["ref_type"].is_nullable == "NO"
    assert cols["ref_number"].is_nullable == "YES"   # commit refs have NULL ref_number
    assert cols["sha"].is_nullable == "YES"          # PR refs have NULL sha
    assert cols["html_url"].is_nullable == "NO"
    assert cols["linked_by"].is_nullable == "YES"    # NULL = automatic link
    assert cols["last_synced_at"].is_nullable == "YES"


async def test_task_github_ref_partial_unique_indexes(db_session):
    # PR/commit have different identity keys → TWO partial unique indexes, NOT one
    # composite UNIQUE. A single composite UNIQUE(task_id,repo,ref_type,ref_number)
    # would NOT match `ON CONFLICT (...) WHERE ref_type=...` in upsert_pr and fail.
    rows = await db_session.execute(text("""
        SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'task_github_ref'
    """))
    defs = {r.indexname: r.indexdef for r in rows.fetchall()}
    assert "idx_tgr_task" in defs
    assert "uq_tgr_pr" in defs, "missing partial unique index for pull_request upsert"
    assert "uq_tgr_commit" in defs, "missing partial unique index for commit upsert"
    assert "ref_number" in defs["uq_tgr_pr"] and "'pull_request'" in defs["uq_tgr_pr"]
    assert "sha" in defs["uq_tgr_commit"] and "'commit'" in defs["uq_tgr_commit"]
    # duplicate-PR upsert (same task/repo/number → UPDATE not INSERT) is exercised
    # against a seeded task in Slice 4 Task 4.4 (upsert_pr).
