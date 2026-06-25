"""Task 담당자 단일 add/remove (전이 표 결정 B) + role-only 로깅 테스트.

Style: direct controller-level calls, raw-INSERT seeding, rollback-isolated db_session.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task_subresource as sub
from core.model import task as task_model


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id, 'username': 'tester'}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Branch", key="KEY"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    bid = row.scalar_one()
    await db.execute(text("""
        INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
        VALUES (:b, 'task', 'Task', 'check', '#5E6AD2', 0)
    """), {"b": bid})
    return bid


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by, title="Task"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "u": created_by})
    return res.scalar_one()


async def _assignee_rows(db, task_id):
    rows = (await db.execute(text(
        "SELECT user_id, role FROM task_assignee WHERE task_id = :t ORDER BY user_id"
    ), {"t": task_id})).fetchall()
    return {r[0]: r[1] for r in rows}


# ---------------------------------------------------------------------------
# Task 2.1 — model upsert/remove/remove_main_except
# ---------------------------------------------------------------------------

async def test_upsert_assignee_insert_and_role_change(db_session):
    alice = await _make_user(db_session, "ua_a@t.test", "ua_a")
    b1 = await _make_branch(db_session, alice, name="UA", key="UAB")
    task1 = await _make_task(db_session, b1, alice, "T1")

    await task_model.upsert_assignee(task1, alice, 'sub', db_session)
    assert (await _assignee_rows(db_session, task1)) == {alice: 'sub'}
    await task_model.upsert_assignee(task1, alice, 'main', db_session)  # role 갱신, 중복 행 X
    assert (await _assignee_rows(db_session, task1)) == {alice: 'main'}
    await task_model.remove_assignee(task1, alice, db_session)
    assert (await _assignee_rows(db_session, task1)) == {}


async def test_remove_main_except(db_session):
    alice = await _make_user(db_session, "rm_a@t.test", "rm_a")
    bob = await _make_user(db_session, "rm_b@t.test", "rm_b")
    b1 = await _make_branch(db_session, alice, name="RM", key="RMB")
    task1 = await _make_task(db_session, b1, alice, "T1")
    await task_model.upsert_assignee(task1, alice, 'main', db_session)

    # 다른 유저를 keep으로 → 기존 main(alice) 제거
    await task_model.remove_main_except(task1, bob, db_session)
    assert (await _assignee_rows(db_session, task1)) == {}
    # keep이 현재 main이면 유지(멱등)
    await task_model.upsert_assignee(task1, alice, 'main', db_session)
    await task_model.remove_main_except(task1, alice, db_session)
    assert (await _assignee_rows(db_session, task1)) == {alice: 'main'}


# ---------------------------------------------------------------------------
# Task 2.2 — controller transition table (결정 B) + role-only logging
# ---------------------------------------------------------------------------

async def test_assignee_transitions(db_session):
    alice = await _make_user(db_session, "tr_a@t.test", "tr_a")
    bob = await _make_user(db_session, "tr_b@t.test", "tr_b")
    carol = await _make_user(db_session, "tr_c@t.test", "tr_c")
    b1 = await _make_branch(db_session, alice, name="TR", key="TRB")
    for u in (alice, bob, carol):
        await _add_member(db_session, b1, u, "admin")
    task1 = await _make_task(db_session, b1, alice, "T1")

    # main 없음 → main 삽입
    assert (await sub.add_task_assignee(task1, alice, 'main', b1, _req(alice), db_session))["status"] is True
    assert (await _assignee_rows(db_session, task1)) == {alice: 'main'}
    # sub 추가
    assert (await sub.add_task_assignee(task1, bob, 'sub', b1, _req(alice), db_session))["status"] is True
    assert (await _assignee_rows(db_session, task1)) == {alice: 'main', bob: 'sub'}
    # 현재 main(alice)에게 sub add → 거부
    res = await sub.add_task_assignee(task1, alice, 'sub', b1, _req(alice), db_session)
    assert res["status"] is False and res["code"] == "INVALID_ASSIGNEE"
    # bob(sub)을 main 승격 → 기존 main(alice) 제거
    assert (await sub.add_task_assignee(task1, bob, 'main', b1, _req(alice), db_session))["status"] is True
    assert (await _assignee_rows(db_session, task1)) == {bob: 'main'}
    # carol을 main → 기존 main(bob) 제거
    assert (await sub.add_task_assignee(task1, carol, 'main', b1, _req(alice), db_session))["status"] is True
    assert (await _assignee_rows(db_session, task1)) == {carol: 'main'}
    # 이미 main인 carol에 main → no-op
    assert (await sub.add_task_assignee(task1, carol, 'main', b1, _req(alice), db_session))["status"] is True
    assert (await _assignee_rows(db_session, task1)) == {carol: 'main'}
    # 제거
    assert (await sub.remove_task_assignee(task1, carol, b1, _req(alice), db_session))["status"] is True
    assert (await _assignee_rows(db_session, task1)) == {}


async def test_add_assignee_rejects_non_member(db_session):
    alice = await _make_user(db_session, "nm_a@t.test", "nm_a")
    stranger = await _make_user(db_session, "nm_s@t.test", "nm_s")
    b1 = await _make_branch(db_session, alice, name="NM", key="NMB")
    await _add_member(db_session, b1, alice, "admin")
    task1 = await _make_task(db_session, b1, alice, "T1")

    res = await sub.add_task_assignee(task1, stranger, 'sub', b1, _req(alice), db_session)
    assert res["status"] is False and res["code"] == "INVALID_ASSIGNEE"


async def test_add_assignee_rejects_cross_branch_task(db_session):
    alice = await _make_user(db_session, "cb_a@t.test", "cb_a")
    bob = await _make_user(db_session, "cb_b@t.test", "cb_b")
    b1 = await _make_branch(db_session, alice, name="CB1", key="CBA")
    await _add_member(db_session, b1, alice, "admin")
    b2 = await _make_branch(db_session, bob, name="CB2", key="CBB")
    foreign_task = await _make_task(db_session, b2, bob, "FT")

    res = await sub.add_task_assignee(foreign_task, alice, 'main', b1, _req(alice), db_session)
    assert res["status"] is False and res["code"] == "TASK_NOT_FOUND"


async def test_promotion_logs_old_main_removal(db_session):
    """sub→main 승격 시 제거되는 기존 main도 활동 로그에 removed로 남아야 한다."""
    alice = await _make_user(db_session, "lg_a@t.test", "lg_a")
    bob = await _make_user(db_session, "lg_b@t.test", "lg_b")
    b1 = await _make_branch(db_session, alice, name="LG", key="LGB")
    await _add_member(db_session, b1, alice, "admin")
    await _add_member(db_session, b1, bob, "member")
    task1 = await _make_task(db_session, b1, alice, "T1")
    await sub.add_task_assignee(task1, alice, 'main', b1, _req(alice), db_session)
    await sub.add_task_assignee(task1, bob, 'sub', b1, _req(alice), db_session)

    res = await sub.add_task_assignee(task1, bob, 'main', b1, _req(alice), db_session)
    assert res["status"] is True

    rows = (await db_session.execute(text(
        "SELECT changes FROM activity_log WHERE entity_type='task' AND entity_id=:t ORDER BY log_id"
    ), {"t": task1})).fetchall()
    removed_ids = []
    for (changes,) in rows:
        for ch in (changes or []):
            for item in (ch.get('removed') or []):
                removed_ids.append(item.get('user_id'))
    assert alice in removed_ids
