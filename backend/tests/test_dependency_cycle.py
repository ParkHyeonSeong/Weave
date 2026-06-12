"""SEC-33: 의존성 순환 검사(check_circular)의 깊이 가드 적용 후 로직 회귀.

재귀 CTE에 depth 추적/상한을 추가했으므로 순환 탐지가 여전히 정확한지 확인한다.
(깊이 상한 1000은 현실 사슬을 한참 넘으므로 정상 그래프 판정엔 영향 없음.)
"""
from sqlalchemy import text

from core.model import task_dependency as dep_model


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, key):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES ('B', :k, 'd', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"k": key, "u": created_by})
    return row.scalar_one()


async def _make_task(db, branch_id, created_by):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, 'T', 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "u": created_by})
    return res.scalar_one()


async def test_direct_back_edge_is_circular(db_session):
    u = await _make_user(db_session, "cyc1@t.local", "cyc1")
    b = await _make_branch(db_session, u, "CYC1")
    a = await _make_task(db_session, b, u)
    c = await _make_task(db_session, b, u)
    # a -> c 존재. c -> a 를 추가하면 순환.
    await dep_model.create(b, a, c, 'finish_to_start', u, db_session)
    assert await dep_model.check_circular(c, a, b, db_session) is True
    # 같은 방향(a -> c)은 순환 아님.
    assert await dep_model.check_circular(a, c, b, db_session) is False


async def test_transitive_chain_cycle_detected(db_session):
    u = await _make_user(db_session, "cyc2@t.local", "cyc2")
    b = await _make_branch(db_session, u, "CYC2")
    a = await _make_task(db_session, b, u)
    c = await _make_task(db_session, b, u)
    d = await _make_task(db_session, b, u)
    # a -> c -> d 사슬. d -> a 를 추가하면 a->c->d->a 순환.
    await dep_model.create(b, a, c, 'finish_to_start', u, db_session)
    await dep_model.create(b, c, d, 'finish_to_start', u, db_session)
    assert await dep_model.check_circular(d, a, b, db_session) is True
    # a -> d 는 순환 아님(역방향 경로 없음).
    assert await dep_model.check_circular(a, d, b, db_session) is False
