"""Subtask transition tests (Task 3): parent_task_id on create/update + one-level invariant.

Style: direct controller-level calls (no HTTP client), seeding with raw INSERTs
via the rollback-isolated ``db_session`` fixture. Mirrors test_idor_task_reorder.py.

Covers:
- promote: explicit parent_task_id=null on PATCH sets the column NULL.
- move: PATCH parent_task_id=<top-level task> attaches as subtask.
- reject: making a task that already HAS subtasks into a subtask (TARGET_HAS_SUBTASKS).
- reject: 2-level nesting — new parent is itself a subtask (PARENT_NOT_TOP_LEVEL).
- create-as-subtask must NOT copy parent sprint/epic (stay NULL).
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task as ctrl
from routers.schema import task as schema


def _req(user_id: int):
    """controller가 읽는 request.state.payload만 흉내낸다."""
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id, 'username': 'u'}))


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
    return row.scalar_one()


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_sprint(db, branch_id, created_by, name="Sprint 1"):
    row = await db.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, goal, created_by, status)
        VALUES (:b, :n, 'goal', :u, 'active') RETURNING sprint_id
    """), {"b": branch_id, "n": name, "u": created_by})
    return row.scalar_one()


async def _make_epic(db, branch_id, created_by, name="Epic 1"):
    row = await db.execute(text("""
        INSERT INTO epic (branch_id, epic_name, color, created_by)
        VALUES (:b, :n, '#5E6AD2', :u) RETURNING epic_id
    """), {"b": branch_id, "n": name, "u": created_by})
    return row.scalar_one()


async def _make_task(db, branch_id, created_by, sprint_id=None, parent_task_id=None,
                     title="Task", status="todo"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by, sprint_id, parent_task_id)
        VALUES (:b, :dn, :t, :st, :u, :s, :p) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "st": status, "u": created_by,
           "s": sprint_id, "p": parent_task_id})
    return res.scalar_one()


async def _make_status(db, branch_id, key, category, label=None, sort_order=0):
    await db.execute(text("""
        INSERT INTO workflow_status (branch_id, key, label, category, color, sort_order)
        VALUES (:b, :k, :l, :c, '#888888', :s)
    """), {"b": branch_id, "k": key, "l": label or key, "c": category, "s": sort_order})


async def _make_task_type(db, branch_id, key="task"):
    await db.execute(text("""
        INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
        VALUES (:b, :k, :k, 'check', '#888888', 0)
    """), {"b": branch_id, "k": key})


async def _task_col(db, task_id, col):
    res = await db.execute(text(f"SELECT {col} FROM task WHERE task_id = :t"), {"t": task_id})
    return res.scalar_one()


# ---------------------------------------------------------------------------
# promote — explicit null on PATCH sets parent NULL
# ---------------------------------------------------------------------------

async def test_promote_sets_parent_null(db_session):
    """하위 → 상위 승격: PATCH parent_task_id=null이 컬럼을 NULL로 set."""
    alice = await _make_user(db_session, "alice_promote@sub.test", "alice_promote")
    branch = await _make_branch(db_session, alice, key="SPPRO")
    await _add_member(db_session, branch, alice, "member")
    await _make_status(db_session, branch, "todo", "todo")
    parent = await _make_task(db_session, branch, alice, title="Parent")
    child = await _make_task(db_session, branch, alice, parent_task_id=parent, title="Child")

    body = schema.TaskUpdate(parent_task_id=None)
    res = await ctrl.update(child, body, branch, _req(alice), db_session)
    assert res["status"] is True
    assert await _task_col(db_session, child, "parent_task_id") is None


# ---------------------------------------------------------------------------
# move — PATCH parent_task_id sets parent
# ---------------------------------------------------------------------------

async def test_move_sets_parent(db_session):
    """상위 → 하위 이동: PATCH parent_task_id=<top-level task>가 컬럼을 set."""
    alice = await _make_user(db_session, "alice_move@sub.test", "alice_move")
    branch = await _make_branch(db_session, alice, key="SPMOV")
    await _add_member(db_session, branch, alice, "member")
    await _make_status(db_session, branch, "todo", "todo")
    parent = await _make_task(db_session, branch, alice, title="Parent")
    target = await _make_task(db_session, branch, alice, title="Target")

    body = schema.TaskUpdate(parent_task_id=parent)
    res = await ctrl.update(target, body, branch, _req(alice), db_session)
    assert res["status"] is True
    assert await _task_col(db_session, target, "parent_task_id") == parent


# ---------------------------------------------------------------------------
# reject — target that already has subtasks cannot become a subtask
# ---------------------------------------------------------------------------

async def test_move_rejects_target_with_subtasks(db_session):
    """하위를 가진 태스크를 하위로 만들려 하면 거부 → TARGET_HAS_SUBTASKS, 변경 없음."""
    alice = await _make_user(db_session, "alice_ths@sub.test", "alice_ths")
    branch = await _make_branch(db_session, alice, key="SPTHS")
    await _add_member(db_session, branch, alice, "member")
    await _make_status(db_session, branch, "todo", "todo")
    new_parent = await _make_task(db_session, branch, alice, title="NewParent")
    target = await _make_task(db_session, branch, alice, title="Target")
    await _make_task(db_session, branch, alice, parent_task_id=target, title="TargetChild")

    body = schema.TaskUpdate(parent_task_id=new_parent)
    res = await ctrl.update(target, body, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "TARGET_HAS_SUBTASKS"
    assert await _task_col(db_session, target, "parent_task_id") is None


# ---------------------------------------------------------------------------
# reject — 2-level nesting (new parent is itself a subtask)
# ---------------------------------------------------------------------------

async def test_move_rejects_two_level(db_session):
    """새 부모가 이미 하위면(2단계 중첩) 거부 → PARENT_NOT_TOP_LEVEL."""
    alice = await _make_user(db_session, "alice_2lvl@sub.test", "alice_2lvl")
    branch = await _make_branch(db_session, alice, key="SP2LV")
    await _add_member(db_session, branch, alice, "member")
    await _make_status(db_session, branch, "todo", "todo")
    grandparent = await _make_task(db_session, branch, alice, title="Grandparent")
    sub = await _make_task(db_session, branch, alice, parent_task_id=grandparent, title="Sub")
    target = await _make_task(db_session, branch, alice, title="Target")

    body = schema.TaskUpdate(parent_task_id=sub)
    res = await ctrl.update(target, body, branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "PARENT_NOT_TOP_LEVEL"
    assert await _task_col(db_session, target, "parent_task_id") is None


# ---------------------------------------------------------------------------
# create-as-subtask must NOT copy parent sprint/epic
# ---------------------------------------------------------------------------

async def test_create_subtask_does_not_copy_sprint_epic(db_session):
    """하위 생성 시 부모의 sprint/epic을 복사하지 않고 NULL로 둔다(§4 — 부모에서 파생)."""
    alice = await _make_user(db_session, "alice_csub@sub.test", "alice_csub")
    branch = await _make_branch(db_session, alice, key="SPCSB")
    await _add_member(db_session, branch, alice, "member")
    await _make_status(db_session, branch, "todo", "todo")
    await _make_task_type(db_session, branch, "task")
    sprint = await _make_sprint(db_session, branch, alice)
    epic = await _make_epic(db_session, branch, alice)
    parent = await _make_task(db_session, branch, alice, sprint_id=sprint, title="Parent")
    # 부모에 epic도 부여
    await db_session.execute(text("UPDATE task SET epic_id = :e WHERE task_id = :t"),
                             {"e": epic, "t": parent})

    # task_sequence를 동기화해야 ctrl.create()의 next_display_number가 중복 없이 작동함
    await db_session.execute(text("""
        INSERT INTO task_sequence (branch_id, last_number)
        VALUES (:b, (SELECT MAX(display_number) FROM task WHERE branch_id = :b))
        ON CONFLICT (branch_id) DO UPDATE SET last_number = EXCLUDED.last_number
    """), {"b": branch})

    body = schema.TaskCreate(title="Sub", parent_task_id=parent)
    res = await ctrl.create(body, branch, _req(alice), db_session)
    assert res["status"] is True
    new_id = res["task_id"]
    assert await _task_col(db_session, new_id, "sprint_id") is None
    assert await _task_col(db_session, new_id, "epic_id") is None
    assert await _task_col(db_session, new_id, "parent_task_id") == parent


# ---------------------------------------------------------------------------
# Task 8: write invariant — transition/creation must NULL own sprint/epic
# ---------------------------------------------------------------------------

async def test_move_to_subtask_nulls_own_sprint_epic(db_session):
    """상위→하위 전환 시 자기 sprint/epic을 NULL로 강제한다(§4 쓰기 불변식).
    남겨두면 stale 값이 Track 등 sprint 연관 쿼리에 잘못 매칭된다."""
    alice = await _make_user(db_session, "alice_null@sub.test", "alice_null")
    branch = await _make_branch(db_session, alice, key="SPNUL")
    await _add_member(db_session, branch, alice, "member")
    await _make_status(db_session, branch, "todo", "todo")
    sprint = await _make_sprint(db_session, branch, alice)
    epic = await _make_epic(db_session, branch, alice)
    parent = await _make_task(db_session, branch, alice, title="Parent")
    target = await _make_task(db_session, branch, alice, sprint_id=sprint, title="Target")
    await db_session.execute(text("UPDATE task SET epic_id = :e WHERE task_id = :t"),
                             {"e": epic, "t": target})

    body = schema.TaskUpdate(parent_task_id=parent)
    res = await ctrl.update(target, body, branch, _req(alice), db_session)
    assert res["status"] is True
    assert await _task_col(db_session, target, "sprint_id") is None
    assert await _task_col(db_session, target, "epic_id") is None


async def test_create_subtask_ignores_explicit_sprint_epic(db_session):
    """하위 생성 시 명시적으로 보낸 sprint/epic도 저장하지 않는다(§4 쓰기 불변식)."""
    alice = await _make_user(db_session, "alice_igsp@sub.test", "alice_igsp")
    branch = await _make_branch(db_session, alice, key="SPIGS")
    await _add_member(db_session, branch, alice, "member")
    await _make_status(db_session, branch, "todo", "todo")
    await _make_task_type(db_session, branch, "task")
    sprint = await _make_sprint(db_session, branch, alice)
    epic = await _make_epic(db_session, branch, alice)
    parent = await _make_task(db_session, branch, alice, title="Parent")
    await db_session.execute(text("""
        INSERT INTO task_sequence (branch_id, last_number)
        VALUES (:b, (SELECT MAX(display_number) FROM task WHERE branch_id = :b))
        ON CONFLICT (branch_id) DO UPDATE SET last_number = EXCLUDED.last_number
    """), {"b": branch})

    body = schema.TaskCreate(title="Sub", parent_task_id=parent,
                             sprint_id=sprint, epic_id=epic)
    res = await ctrl.create(body, branch, _req(alice), db_session)
    assert res["status"] is True
    new_id = res["task_id"]
    assert await _task_col(db_session, new_id, "sprint_id") is None
    assert await _task_col(db_session, new_id, "epic_id") is None
