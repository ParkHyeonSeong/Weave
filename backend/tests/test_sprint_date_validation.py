from datetime import date
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import sprint as ctrl
from routers.schema import sprint as schema


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


async def _make_sprint(db, branch_id, created_by, start=None, end=None):
    row = await db.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, goal, created_by, status, start_date, end_date)
        VALUES (:b, 'S', 'g', :u, 'future', :s, :e) RETURNING sprint_id
    """), {"b": branch_id, "u": created_by, "s": start, "e": end})
    return row.scalar_one()


async def _col(db, sprint_id, c):
    res = await db.execute(text(f"SELECT {c} FROM sprint WHERE sprint_id = :s"), {"s": sprint_id})
    return res.scalar_one()


async def test_create_rejects_start_after_end(db_session):
    alice = await _make_user(db_session, "a_screate@d.test", "a_screate")
    branch = await _make_branch(db_session, alice, "SDV1")
    await _add_member(db_session, branch, alice)
    body = schema.SprintCreate(sprint_name='S', start_date=date(2026, 6, 25), end_date=date(2026, 6, 18))
    res = await ctrl.create(body, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "INVALID_DATE_RANGE"
    count = (await db_session.execute(
        text("SELECT COUNT(*) FROM sprint WHERE branch_id = :b"), {"b": branch}
    )).scalar_one()
    assert count == 0


async def test_create_allows_equal_dates(db_session):
    alice = await _make_user(db_session, "a_sceq@d.test", "a_sceq")
    branch = await _make_branch(db_session, alice, "SDV2")
    await _add_member(db_session, branch, alice)
    body = schema.SprintCreate(sprint_name='S', start_date=date(2026, 6, 20), end_date=date(2026, 6, 20))
    res = await ctrl.create(body, branch, _req(alice), db_session)
    assert res["status"] is True


async def test_update_partial_start_after_stored_end_rejected(db_session):
    """저장된 end_date(6/20)만 있고 start_date만 6/25로 PATCH → 병합 검증으로 거부."""
    alice = await _make_user(db_session, "a_supd@d.test", "a_supd")
    branch = await _make_branch(db_session, alice, "SDV3")
    await _add_member(db_session, branch, alice)
    sprint = await _make_sprint(db_session, branch, alice, start=None, end=date(2026, 6, 20))
    body = schema.SprintUpdate(start_date=date(2026, 6, 25))
    res = await ctrl.update(sprint, body, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "INVALID_DATE_RANGE"
    # 거부 시 컬럼 변경 없어야 함
    assert await _col(db_session, sprint, "start_date") is None


async def test_update_partial_valid(db_session):
    alice = await _make_user(db_session, "a_supok@d.test", "a_supok")
    branch = await _make_branch(db_session, alice, "SDV4")
    await _add_member(db_session, branch, alice)
    sprint = await _make_sprint(db_session, branch, alice, start=None, end=date(2026, 6, 20))
    body = schema.SprintUpdate(start_date=date(2026, 6, 18))
    res = await ctrl.update(sprint, body, branch, _req(alice), db_session)
    assert res["status"] is True
    assert await _col(db_session, sprint, "start_date") == date(2026, 6, 18)


async def test_update_clear_end_date_via_null(db_session):
    """명시적 null로 종료일 삭제 가능(exclude_none + 날짜 필드 null re-add). 한쪽 None이라 검증 통과."""
    alice = await _make_user(db_session, "a_sclr@d.test", "a_sclr")
    branch = await _make_branch(db_session, alice, "SDV5")
    await _add_member(db_session, branch, alice)
    sprint = await _make_sprint(db_session, branch, alice, start=date(2026, 6, 18), end=date(2026, 6, 20))
    body = schema.SprintUpdate(end_date=None)
    res = await ctrl.update(sprint, body, branch, _req(alice), db_session)
    assert res["status"] is True
    assert await _col(db_session, sprint, "end_date") is None


async def test_update_non_null_field_null_is_noop(db_session):
    """status=null 같은 NOT NULL 컬럼의 null은 무시(no-op) — 500 없이 기존값 유지."""
    alice = await _make_user(db_session, "a_snoop@d.test", "a_snoop")
    branch = await _make_branch(db_session, alice, "SDV6")
    await _add_member(db_session, branch, alice)
    sprint = await _make_sprint(db_session, branch, alice)  # status 'future'
    body = schema.SprintUpdate(status=None)
    res = await ctrl.update(sprint, body, branch, _req(alice), db_session)
    assert res["status"] is True
    assert await _col(db_session, sprint, "status") == "future"
