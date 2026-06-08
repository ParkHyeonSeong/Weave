from sqlalchemy import text

from core.model import scrum_board as board_model
from core.model import scrum_member as member_model


async def _make_user(db, email="scrum-u1@test.local", username="scrumu1"):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def test_create_and_find(db_session):
    uid = await _make_user(db_session)
    board_id = await board_model.create(
        name="디자인팀", icon="lucide:users", color="#16A34A",
        visibility="private", retro_cadence="weekly", retro_interval_weeks=None,
        retro_template="kpt", retro_anchor_weekday=4, created_by=uid, db=db_session)
    assert isinstance(board_id, int)

    found = await board_model.find_by_id(board_id, db_session)
    assert found is not None
    assert found["name"] == "디자인팀"
    assert found["retro_cadence"] == "weekly"
    assert found["retro_anchor_weekday"] == 4


async def test_find_accessible_only_for_members(db_session):
    owner = await _make_user(db_session, "owner@test.local", "owner")
    stranger = await _make_user(db_session, "stranger@test.local", "stranger")
    board_id = await board_model.create(
        name="플랫폼팀", icon=None, color="#16A34A", visibility="private",
        retro_cadence="weekly", retro_interval_weeks=None, retro_template="kpt",
        retro_anchor_weekday=4, created_by=owner, db=db_session)
    await member_model.add(board_id, owner, "admin", db_session)

    mine = await board_model.find_accessible(owner, db_session)
    assert any(b["board_id"] == board_id for b in mine)
    one = next(b for b in mine if b["board_id"] == board_id)
    assert one["my_role"] == "admin"
    assert one["member_count"] == 1

    theirs = await board_model.find_accessible(stranger, db_session)
    assert all(b["board_id"] != board_id for b in theirs)


async def test_update(db_session):
    uid = await _make_user(db_session, "upd@test.local", "upd")
    board_id = await board_model.create(
        name="old", icon=None, color="#16A34A", visibility="private",
        retro_cadence="weekly", retro_interval_weeks=None, retro_template="kpt",
        retro_anchor_weekday=4, created_by=uid, db=db_session)
    await board_model.update(board_id, {"name": "new", "retro_cadence": "biweekly"}, db_session)
    found = await board_model.find_by_id(board_id, db_session)
    assert found["name"] == "new"
    assert found["retro_cadence"] == "biweekly"

    # 화이트리스트 밖 키는 무시(동적 SQL의 보안 경계), 빈 dict는 no-op
    await board_model.update(board_id, {"created_by": 999, "is_archived": True}, db_session)
    await board_model.update(board_id, {}, db_session)
    found = await board_model.find_by_id(board_id, db_session)
    assert found is not None          # is_archived 무시됨 → 여전히 조회됨
    assert found["created_by"] == uid  # created_by 변경되지 않음


async def test_archive_hides_board(db_session):
    uid = await _make_user(db_session, "arc@test.local", "arc")
    board_id = await board_model.create(
        name="temp", icon=None, color="#16A34A", visibility="private",
        retro_cadence="weekly", retro_interval_weeks=None, retro_template="kpt",
        retro_anchor_weekday=4, created_by=uid, db=db_session)
    await member_model.add(board_id, uid, "admin", db_session)
    await board_model.archive(board_id, db_session)
    assert await board_model.find_by_id(board_id, db_session) is None
    # 아카이브된 보드는 내 보드 목록에서도 제외
    mine = await board_model.find_accessible(uid, db_session)
    assert all(b["board_id"] != board_id for b in mine)
