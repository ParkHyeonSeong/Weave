from sqlalchemy import text


async def test_db_session_connects(db_session):
    result = await db_session.execute(text("SELECT 1"))
    assert result.scalar_one() == 1


async def test_user_table_exists(db_session):
    result = await db_session.execute(text("SELECT to_regclass('public.\"user\"')"))
    assert result.scalar_one() is not None


async def test_pat_table_exists(db_session):
    from sqlalchemy import text
    result = await db_session.execute(text("SELECT to_regclass('public.personal_access_token')"))
    assert result.scalar_one() is not None
