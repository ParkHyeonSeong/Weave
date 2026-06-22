from datetime import date
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import epic as ctrl
from routers.schema import epic as schema


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id, 'username': 'u'}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, key):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES ('B', :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"k": key, "u": created_by})
    return row.scalar_one()


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_epic(db, branch_id, created_by, start=None, due=None):
    row = await db.execute(text("""
        INSERT INTO epic (branch_id, epic_name, color, created_by, start_date, due_date)
        VALUES (:b, 'E', '#5E6AD2', :u, :s, :d) RETURNING epic_id
    """), {"b": branch_id, "u": created_by, "s": start, "d": due})
    return row.scalar_one()


async def _col(db, epic_id, c):
    res = await db.execute(text(f"SELECT {c} FROM epic WHERE epic_id = :e"), {"e": epic_id})
    return res.scalar_one()


async def test_create_rejects_start_after_due(db_session):
    alice = await _make_user(db_session, "a_ecreate@d.test", "a_ecreate")
    branch = await _make_branch(db_session, alice, "EDV1")
    await _add_member(db_session, branch, alice)
    body = schema.EpicCreate(epic_name='E', start_date=date(2026, 6, 25), due_date=date(2026, 6, 18))
    res = await ctrl.create(body, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "INVALID_DATE_RANGE"
    count = (await db_session.execute(
        text("SELECT COUNT(*) FROM epic WHERE branch_id = :b"), {"b": branch}
    )).scalar_one()
    assert count == 0


async def test_create_valid(db_session):
    alice = await _make_user(db_session, "a_ecok@d.test", "a_ecok")
    branch = await _make_branch(db_session, alice, "EDV2")
    await _add_member(db_session, branch, alice)
    body = schema.EpicCreate(epic_name='E', start_date=date(2026, 6, 18), due_date=date(2026, 6, 25))
    res = await ctrl.create(body, branch, _req(alice), db_session)
    assert res["status"] is True


async def test_update_partial_due_before_stored_start_rejected(db_session):
    alice = await _make_user(db_session, "a_eupd@d.test", "a_eupd")
    branch = await _make_branch(db_session, alice, "EDV3")
    await _add_member(db_session, branch, alice)
    epic = await _make_epic(db_session, branch, alice, start=date(2026, 6, 20), due=None)
    body = schema.EpicUpdate(due_date=date(2026, 6, 10))
    res = await ctrl.update(epic, body, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "INVALID_DATE_RANGE"
    assert await _col(db_session, epic, "due_date") is None


async def test_update_clear_due_date_via_null(db_session):
    """명시적 null로 마감일 삭제 가능(exclude_none + 날짜 null re-add / model_fields_set)."""
    alice = await _make_user(db_session, "a_eclr@d.test", "a_eclr")
    branch = await _make_branch(db_session, alice, "EDV4")
    await _add_member(db_session, branch, alice)
    epic = await _make_epic(db_session, branch, alice, start=date(2026, 6, 18), due=date(2026, 6, 20))
    body = schema.EpicUpdate(due_date=None)
    res = await ctrl.update(epic, body, branch, _req(alice), db_session)
    assert res["status"] is True
    assert await _col(db_session, epic, "due_date") is None


async def test_update_non_null_field_null_is_noop(db_session):
    """color=null 같은 NOT NULL 컬럼의 null은 무시(no-op) — 500 없이 기존값 유지."""
    alice = await _make_user(db_session, "a_enoop@d.test", "a_enoop")
    branch = await _make_branch(db_session, alice, "EDV5")
    await _add_member(db_session, branch, alice)
    epic = await _make_epic(db_session, branch, alice)  # color '#5E6AD2'
    body = schema.EpicUpdate(color=None)
    res = await ctrl.update(epic, body, branch, _req(alice), db_session)
    assert res["status"] is True
    assert await _col(db_session, epic, "color") == "#5E6AD2"
