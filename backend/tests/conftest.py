import os
import subprocess
import sys
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from config import DATABASE_URL

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _test_db_url() -> str:
    explicit = os.getenv("TEST_DATABASE_URL")
    if explicit:
        return explicit
    url = make_url(DATABASE_URL)
    return url.set(database=(url.database or "weave") + "_test").render_as_string(hide_password=False)


TEST_DATABASE_URL = _test_db_url()


@pytest.fixture(scope="session")
def migrated_test_db():
    """Run the real Alembic migration chain against the test database, once."""
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(BACKEND_DIR),
        env={**os.environ, "DATABASE_URL": TEST_DATABASE_URL},
        check=True,
    )
    return TEST_DATABASE_URL


@pytest_asyncio.fixture
async def db_session(migrated_test_db) -> AsyncSession:
    """Per-test session inside a transaction that is rolled back (full isolation).

    Model/controller functions must NOT commit internally (commit is the route layer's
    job in this codebase), so their writes are visible within the transaction and undone
    on rollback.
    """
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    conn = await engine.connect()
    trans = await conn.begin()
    SessionLocal = async_sessionmaker(bind=conn, expire_on_commit=False, class_=AsyncSession)
    session = SessionLocal()
    try:
        yield session
    finally:
        await session.close()
        await trans.rollback()
        await conn.close()
        await engine.dispose()
