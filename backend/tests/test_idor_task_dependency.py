"""IDOR regression tests for task_dependency.create (LOG-07).

Style: direct controller-level calls (no HTTP client), seeding with raw INSERTs
via the rollback-isolated ``db_session`` fixture. See test_track_home.py /
test_idor_workflow_status.py for the shared pattern.

Gap: ``create`` only checked that the caller was a member of the URL branch_id
and never verified that source_task_id / target_task_id belonged to branches the
caller can access. A branch-1 member could therefore weave a dependency onto
arbitrary tasks of a branch they are NOT a member of (cross-branch IDOR).

Design nuance: Weave intentionally supports cross-branch (cross-project)
dependencies. The fix must NOT block cross-branch links — it must require the
caller to be a member of BOTH tasks' branches. Same rule as the proven
``track.py._try_materialize_flow_dep`` path.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task_dependency as ctrl
from routers.schema import task_dependency as schema


def _req(user_id: int):
    """controller가 읽는 request.state.payload만 흉내낸다."""
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


# ---------------------------------------------------------------------------
# seed helpers (raw INSERT — real schema column names)
# ---------------------------------------------------------------------------

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
    for key_, label, color_, category, sort in [
        ("todo", "To Do", "#9CA3AF", "todo", 0),
        ("in_progress", "In Progress", "#2563EB", "in_progress", 1),
        ("done", "Done", "#16A34A", "done", 2),
        ("cancelled", "Cancelled", "#DC2626", "cancelled", 3),
    ]:
        await db.execute(text("""
            INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order)
            VALUES (:b, :k, :l, :c, :cat, :s)
        """), {"b": bid, "k": key_, "l": label, "c": color_, "cat": category, "s": sort})
    return bid


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
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


async def _deps(db):
    res = await db.execute(text("""
        SELECT dependency_id, branch_id, source_task_id, target_task_id, dep_type
        FROM task_dependency
    """))
    return [dict(r._mapping) for r in res.fetchall()]


# ---------------------------------------------------------------------------
# IDOR — caller is not a member of the other task's branch
# ---------------------------------------------------------------------------

async def test_create_rejects_task_from_branch_user_is_not_member_of(db_session):
    """branch1 멤버 alice가 (멤버가 아닌) branch2의 task를 의존성 한쪽 끝에 끼움 → 거부."""
    alice = await _make_user(db_session, "alice@idor.test", "alice")
    bob = await _make_user(db_session, "bob@idor.test", "bob")

    branch1 = await _make_branch(db_session, alice, name="B1", key="IDB1")
    await _add_member(db_session, branch1, alice, "member")
    task1 = await _make_task(db_session, branch1, alice, "B1 Task")

    # branch2: alice는 멤버가 아니다.
    branch2 = await _make_branch(db_session, bob, name="B2", key="IDB2")
    await _add_member(db_session, branch2, bob, "admin")
    task2 = await _make_task(db_session, branch2, bob, "B2 Task")

    # source가 타 branch task (target은 본인 branch)
    res = await ctrl.create(
        schema.DependencyCreate(source_task_id=task2, target_task_id=task1,
                                dep_type="finish_to_start"),
        branch1, _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "NOT_BRANCH_MEMBER"

    # target이 타 branch task
    res = await ctrl.create(
        schema.DependencyCreate(source_task_id=task1, target_task_id=task2,
                                dep_type="finish_to_start"),
        branch1, _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "NOT_BRANCH_MEMBER"

    # 둘 다 타 branch task
    res = await ctrl.create(
        schema.DependencyCreate(source_task_id=task2, target_task_id=task1,
                                dep_type="relates_to"),
        branch1, _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "NOT_BRANCH_MEMBER"

    # 아무 dependency도 생성되지 않아야 한다.
    assert await _deps(db_session) == []


async def test_create_rejects_unknown_task(db_session):
    """존재하지 않는 task id면 TASK_NOT_FOUND."""
    alice = await _make_user(db_session, "alice_nf@idor.test", "alice_nf")
    branch1 = await _make_branch(db_session, alice, name="B1", key="NFB1")
    await _add_member(db_session, branch1, alice, "member")
    task1 = await _make_task(db_session, branch1, alice, "Task")

    res = await ctrl.create(
        schema.DependencyCreate(source_task_id=task1, target_task_id=999999,
                                dep_type="finish_to_start"),
        branch1, _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "TASK_NOT_FOUND"


# ---------------------------------------------------------------------------
# regression — cross-branch dependency is allowed when caller is member of both
# ---------------------------------------------------------------------------

async def test_create_cross_branch_allowed_when_member_of_both(db_session):
    """alice가 branch1·branch2 모두 멤버이면 cross-branch 의존성은 정상 생성."""
    alice = await _make_user(db_session, "alice_x@idor.test", "alice_x")

    branch1 = await _make_branch(db_session, alice, name="B1", key="XB1")
    await _add_member(db_session, branch1, alice, "admin")
    task1 = await _make_task(db_session, branch1, alice, "B1 Task")

    branch2 = await _make_branch(db_session, alice, name="B2", key="XB2")
    await _add_member(db_session, branch2, alice, "member")
    task2 = await _make_task(db_session, branch2, alice, "B2 Task")

    res = await ctrl.create(
        schema.DependencyCreate(source_task_id=task1, target_task_id=task2,
                                dep_type="finish_to_start"),
        branch1, _req(alice), db_session,
    )
    assert res["status"] is True
    assert res.get("dependency_id")

    deps = await _deps(db_session)
    assert len(deps) == 1
    dep = deps[0]
    # cross-branch → branch_id NULL (045 migration), task 양 끝은 보존
    assert dep["branch_id"] is None
    assert dep["source_task_id"] == task1
    assert dep["target_task_id"] == task2


# ---------------------------------------------------------------------------
# regression — same-branch dependency still works (branch_id scoped)
# ---------------------------------------------------------------------------

async def test_create_same_branch_succeeds(db_session):
    alice = await _make_user(db_session, "alice_ok@idor.test", "alice_ok")
    branch1 = await _make_branch(db_session, alice, name="B1", key="OKB1")
    await _add_member(db_session, branch1, alice, "member")
    task_a = await _make_task(db_session, branch1, alice, "A")
    task_b = await _make_task(db_session, branch1, alice, "B")

    res = await ctrl.create(
        schema.DependencyCreate(source_task_id=task_a, target_task_id=task_b,
                                dep_type="finish_to_start"),
        branch1, _req(alice), db_session,
    )
    assert res["status"] is True
    assert res.get("dependency_id")

    deps = await _deps(db_session)
    assert len(deps) == 1
    dep = deps[0]
    # same-branch → branch_id 채워짐
    assert dep["branch_id"] == branch1
    assert dep["source_task_id"] == task_a
    assert dep["target_task_id"] == task_b
