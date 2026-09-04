"""WEAVE-43 — 부모 Main 담당자 변경이 '갈라지지 않은' 직접 하위에만 조건부 전파된다.

규칙: new_main이 non-null이고 old_main과 다를 때만. 하위 중 main == old_main 또는
main 없음인 것만 새 main으로. 다른 main·sub-only 변경·main 해제·dry_run·하위 자체 변경은 무전파.
replace(update) 경로와 granular add_task_assignee(role='main') 경로는 같은 결과.

Style: direct controller calls, raw-INSERT seeding, rollback-isolated db_session
(test_subtask_transition.py / test_controller_task_subresource_assignee.py와 동일).
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task as ctrl
from core.controller import task_subresource as sub
from routers.schema import task as schema


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id, 'username': 'actor'}))


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
    bid = row.scalar_one()
    await db.execute(text("""
        INSERT INTO workflow_status (branch_id, key, label, category, color, sort_order)
        VALUES (:b, 'todo', 'todo', 'todo', '#888888', 0)
    """), {"b": bid})
    await db.execute(text("""
        INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
        VALUES (:b, 'task', 'Task', 'check', '#888888', 0)
    """), {"b": bid})
    return bid


async def _add_member(db, branch_id, user_id):
    await db.execute(text(
        "INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, 'member')"
    ), {"b": branch_id, "u": user_id})


async def _make_task(db, branch_id, created_by, title, parent_task_id=None):
    dn = (await db.execute(text(
        "SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b"
    ), {"b": branch_id})).scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by, parent_task_id)
        VALUES (:b, :dn, :t, 'todo', :u, :p) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "u": created_by, "p": parent_task_id})
    return res.scalar_one()


async def _set_assignee(db, task_id, user_id, role):
    await db.execute(text(
        "INSERT INTO task_assignee (task_id, user_id, role) VALUES (:t, :u, :r)"
    ), {"t": task_id, "u": user_id, "r": role})


async def _assignee_rows(db, task_id):
    rows = (await db.execute(text(
        "SELECT user_id, role FROM task_assignee WHERE task_id = :t ORDER BY user_id"
    ), {"t": task_id})).fetchall()
    return {r[0]: r[1] for r in rows}


async def _activity_count(db, task_id):
    return (await db.execute(text(
        "SELECT COUNT(*) FROM activity_log WHERE entity_type='task' AND entity_id=:t"
    ), {"t": task_id})).scalar_one()


async def _notifications(db, user_id, task_id):
    rows = (await db.execute(text("""
        SELECT type FROM notification
        WHERE user_id=:u AND entity_type='task' AND entity_id=:t
    """), {"u": user_id, "t": task_id})).fetchall()
    return [r[0] for r in rows]


async def _seed(db, key, parent_main='alice'):
    """alice(actor)/bob/carol 멤버 + parent + 직접 하위 3개(follows/empty/diverged)."""
    alice = await _make_user(db, f"{key}_a@t.test", f"{key}_alice")
    bob = await _make_user(db, f"{key}_b@t.test", f"{key}_bob")
    carol = await _make_user(db, f"{key}_c@t.test", f"{key}_carol")
    branch = await _make_branch(db, alice, key)
    for u in (alice, bob, carol):
        await _add_member(db, branch, u)
    parent = await _make_task(db, branch, alice, "Parent")
    if parent_main == 'alice':
        await _set_assignee(db, parent, alice, 'main')
    follows = await _make_task(db, branch, alice, "follows", parent)    # main == 부모 이전 main
    await _set_assignee(db, follows, alice, 'main')
    empty = await _make_task(db, branch, alice, "empty", parent)        # main 없음
    diverged = await _make_task(db, branch, alice, "diverged", parent)  # 다른 main
    await _set_assignee(db, diverged, carol, 'main')
    return dict(alice=alice, bob=bob, carol=carol, branch=branch, parent=parent,
                follows=follows, empty=empty, diverged=diverged)


async def _patch(db, s, task_id, main, subs, **extra):
    res = await ctrl.update(task_id,
                            schema.TaskUpdate(assignees=schema.AssigneeInput(main=main, sub=subs), **extra),
                            s['branch'], _req(s['alice']), db)
    assert res["status"] is True
    return res


# --- 전파 규칙 ---------------------------------------------------------------

async def test_parent_a_to_b_cascades_to_undiverged_subtasks(db_session):
    """A→B: 하위 A는 B, Main 없음은 B, C는 C 유지."""
    s = await _seed(db_session, "CAS1")
    await _patch(db_session, s, s['parent'], s['bob'], [])
    assert await _assignee_rows(db_session, s['follows']) == {s['bob']: 'main'}
    assert await _assignee_rows(db_session, s['empty']) == {s['bob']: 'main'}
    assert await _assignee_rows(db_session, s['diverged']) == {s['carol']: 'main'}


async def test_parent_null_to_b_cascades_to_unassigned_subtasks(db_session):
    """null→B: Main 없는 직접 하위는 B, Main A/C인 하위는 유지(이전 main None과 다름)."""
    s = await _seed(db_session, "CAS2", parent_main=None)
    await _patch(db_session, s, s['parent'], s['bob'], [])
    assert await _assignee_rows(db_session, s['empty']) == {s['bob']: 'main'}
    assert await _assignee_rows(db_session, s['follows']) == {s['alice']: 'main'}
    assert await _assignee_rows(db_session, s['diverged']) == {s['carol']: 'main'}


async def test_parent_b_to_null_does_not_touch_subtasks(db_session):
    """B→null(해제): 하위 담당자를 지우지 않는다."""
    s = await _seed(db_session, "CAS3")
    await _patch(db_session, s, s['parent'], None, [])
    assert await _assignee_rows(db_session, s['follows']) == {s['alice']: 'main'}
    assert await _assignee_rows(db_session, s['empty']) == {}
    assert await _assignee_rows(db_session, s['diverged']) == {s['carol']: 'main'}


async def test_sub_only_change_does_not_cascade(db_session):
    s = await _seed(db_session, "CAS4")
    await _patch(db_session, s, s['parent'], s['alice'], [s['bob']])
    assert await _assignee_rows(db_session, s['follows']) == {s['alice']: 'main'}
    assert await _assignee_rows(db_session, s['empty']) == {}


async def test_same_main_reassigned_does_not_cascade(db_session):
    """A→A(값 동일): 무전파 — empty 하위가 A로 바뀌면 안 된다."""
    s = await _seed(db_session, "CAS5")
    await _patch(db_session, s, s['parent'], s['alice'], [])
    assert await _assignee_rows(db_session, s['empty']) == {}


async def test_cascade_preserves_child_subs_and_promotes_existing_sub(db_session):
    """하위 Sub는 보존. 새 main이 이미 Sub였다면 승격되고 중복 행 없음."""
    s = await _seed(db_session, "CAS6")
    await _set_assignee(db_session, s['follows'], s['bob'], 'sub')
    await _set_assignee(db_session, s['follows'], s['carol'], 'sub')
    await _set_assignee(db_session, s['empty'], s['carol'], 'sub')
    await _patch(db_session, s, s['parent'], s['bob'], [])
    assert await _assignee_rows(db_session, s['follows']) == {s['bob']: 'main', s['carol']: 'sub'}
    assert await _assignee_rows(db_session, s['empty']) == {s['bob']: 'main', s['carol']: 'sub'}


async def test_dry_run_changes_nothing(db_session):
    """dry_run: 하위 DB·activity·notification 모두 변화 없음."""
    s = await _seed(db_session, "CAS7")
    act_before = {k: await _activity_count(db_session, s[k]) for k in ('follows', 'empty', 'diverged')}
    res = await _patch(db_session, s, s['parent'], s['bob'], [], dry_run=True)
    assert res["status"] is True
    assert await _assignee_rows(db_session, s['follows']) == {s['alice']: 'main'}
    assert await _assignee_rows(db_session, s['empty']) == {}
    for k, before in act_before.items():
        assert await _activity_count(db_session, s[k]) == before
    assert await _notifications(db_session, s['bob'], s['follows']) == []
    assert await _notifications(db_session, s['bob'], s['empty']) == []


async def test_subtask_own_change_does_not_cascade_anywhere(db_session):
    """하위 자체의 main 변경은 형제·부모로 전파되지 않는다."""
    s = await _seed(db_session, "CAS8")
    await _patch(db_session, s, s['follows'], s['bob'], [])
    assert await _assignee_rows(db_session, s['follows']) == {s['bob']: 'main'}
    assert await _assignee_rows(db_session, s['parent']) == {s['alice']: 'main'}
    assert await _assignee_rows(db_session, s['empty']) == {}
    assert await _assignee_rows(db_session, s['diverged']) == {s['carol']: 'main'}


# --- activity / notification --------------------------------------------------

async def test_only_changed_subtasks_get_activity_and_notification(db_session):
    s = await _seed(db_session, "CAS9")
    before = {k: await _activity_count(db_session, s[k]) for k in ('follows', 'empty', 'diverged')}
    await _patch(db_session, s, s['parent'], s['bob'], [])
    assert await _activity_count(db_session, s['follows']) > before['follows']
    assert await _activity_count(db_session, s['empty']) > before['empty']
    assert await _activity_count(db_session, s['diverged']) == before['diverged']
    assert await _notifications(db_session, s['bob'], s['follows']) == ['task_assigned']
    assert await _notifications(db_session, s['bob'], s['empty']) == ['task_assigned']
    assert await _notifications(db_session, s['bob'], s['diverged']) == []
    # 부모 자신의 알림은 기존 경로 1건 그대로(중복 없음)
    assert await _notifications(db_session, s['bob'], s['parent']) == ['task_assigned']


async def test_no_notification_when_child_already_had_new_main_as_sub(db_session):
    """이미 담당자(Sub)였던 유저가 Main으로 승격되는 하위엔 task_assigned를 보내지 않는다(granular와 동일 의미)."""
    s = await _seed(db_session, "CAS10")
    await _set_assignee(db_session, s['follows'], s['bob'], 'sub')
    await _patch(db_session, s, s['parent'], s['bob'], [])
    assert await _notifications(db_session, s['bob'], s['follows']) == []
    assert await _notifications(db_session, s['bob'], s['empty']) == ['task_assigned']


# --- granular 경로 동일 결과 ------------------------------------------------------

async def test_granular_add_main_matches_replace_path(db_session):
    """POST /tasks/{id}/assignees role=main(MCP add_task_assignee)도 같은 규칙·같은 결과."""
    s = await _seed(db_session, "CAS11")
    res = await sub.add_task_assignee(s['parent'], s['bob'], 'main', s['branch'],
                                      _req(s['alice']), db_session)
    assert res["status"] is True
    assert await _assignee_rows(db_session, s['follows']) == {s['bob']: 'main'}
    assert await _assignee_rows(db_session, s['empty']) == {s['bob']: 'main'}
    assert await _assignee_rows(db_session, s['diverged']) == {s['carol']: 'main'}
    assert await _notifications(db_session, s['bob'], s['follows']) == ['task_assigned']
    assert await _notifications(db_session, s['bob'], s['diverged']) == []


async def test_granular_add_sub_and_remove_do_not_cascade(db_session):
    s = await _seed(db_session, "CAS12")
    res = await sub.add_task_assignee(s['parent'], s['bob'], 'sub', s['branch'],
                                      _req(s['alice']), db_session)
    assert res["status"] is True
    assert await _assignee_rows(db_session, s['empty']) == {}
    res = await sub.remove_task_assignee(s['parent'], s['alice'], s['branch'],
                                         _req(s['alice']), db_session)
    assert res["status"] is True
    assert await _assignee_rows(db_session, s['follows']) == {s['alice']: 'main'}


# --- 기존 계약 회귀 없음 ------------------------------------------------------------

async def test_invalid_assignee_still_rejected_before_any_cascade(db_session):
    """비멤버 main 지정은 INVALID_ASSIGNEE(200+status False)로 거부되고 하위도 그대로."""
    s = await _seed(db_session, "CAS13")
    outsider = await _make_user(db_session, "CAS13_x@t.test", "CAS13_outsider")
    res = await ctrl.update(s['parent'],
                            schema.TaskUpdate(assignees=schema.AssigneeInput(main=outsider, sub=[])),
                            s['branch'], _req(s['alice']), db_session)
    assert res["status"] is False and res["code"] == "INVALID_ASSIGNEE"
    assert await _assignee_rows(db_session, s['empty']) == {}


async def test_non_member_actor_still_rejected(db_session):
    s = await _seed(db_session, "CAS14")
    outsider = await _make_user(db_session, "CAS14_x@t.test", "CAS14_outsider")
    res = await ctrl.update(s['parent'],
                            schema.TaskUpdate(assignees=schema.AssigneeInput(main=s['bob'], sub=[])),
                            s['branch'], _req(outsider), db_session)
    assert res["status"] is False and res["code"] == "NOT_BRANCH_MEMBER"
    assert await _assignee_rows(db_session, s['empty']) == {}
