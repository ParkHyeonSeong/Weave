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


async def test_github_webhook_event_table_exists(db_session):
    reg = await db_session.execute(text("SELECT to_regclass('public.github_webhook_event')"))
    assert reg.scalar_one() is not None


async def test_github_webhook_event_columns(db_session):
    cols = await _columns(db_session, "github_webhook_event")
    assert cols["delivery_id"].is_nullable == "NO"
    assert cols["event_type"].is_nullable == "NO"
    assert cols["payload"].data_type == "jsonb"
    assert cols["status"].is_nullable == "NO"
    assert cols["status"].column_default is not None and "pending" in cols["status"].column_default
    assert cols["attempts"].is_nullable == "NO"
    assert cols["locked_at"].is_nullable == "YES"
    assert cols["processed_at"].is_nullable == "YES"
    assert cols["last_error"].is_nullable == "YES"


async def test_github_webhook_event_delivery_id_unique(db_session):
    # the UNIQUE on delivery_id is what blocks GitHub redelivery (row dup)
    from sqlalchemy.exc import IntegrityError
    await db_session.execute(text("""
        INSERT INTO github_webhook_event (delivery_id, event_type, payload)
        VALUES ('dup-1', 'pull_request', '{}'::jsonb)
    """))
    try:
        await db_session.execute(text("""
            INSERT INTO github_webhook_event (delivery_id, event_type, payload)
            VALUES ('dup-1', 'pull_request', '{}'::jsonb)
        """))
        inserted_twice = True
    except IntegrityError:
        inserted_twice = False
    assert inserted_twice is False


async def test_github_webhook_event_partial_claimable_index(db_session):
    rows = await db_session.execute(text("""
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'github_webhook_event' AND indexname = 'idx_ghwe_claimable'
    """))
    defn = rows.scalar_one_or_none()
    assert defn is not None
    assert "WHERE" in defn.upper() and "pending" in defn and "failed" in defn


async def test_user_is_system_column(db_session):
    cols = await _columns(db_session, "user")
    assert "is_system" in cols
    assert cols["is_system"].data_type == "boolean"
    assert cols["is_system"].is_nullable == "NO"
    assert cols["is_system"].column_default is not None and "false" in cols["is_system"].column_default.lower()


async def test_github_bot_seeded(db_session):
    row = await db_session.execute(text("""
        SELECT user_id, is_system, status FROM "user"
        WHERE email = 'github-bot@weave.local'
    """))
    bot = row.fetchone()
    assert bot is not None
    assert bot.is_system is True
    # exactly one bot
    cnt = await db_session.execute(text("""
        SELECT COUNT(*) FROM "user" WHERE email = 'github-bot@weave.local'
    """))
    assert cnt.scalar_one() == 1
