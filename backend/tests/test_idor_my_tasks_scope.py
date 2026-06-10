"""IDOR regression tests for the my-tasks list endpoint (MY-TASKS-XSCOPE-LEAK).

``task_model.find_by_assignee`` (behind GET /api/my-tasks) returned every task
the caller is assigned to (``task_assignee``) joined with the task's *current*
branch metadata — without re-checking that the caller is still a member of that
branch. Because ``task_assignee`` rows survive removal from ``branch_member``, a
user removed from a branch kept seeing the live title / status / branch name /
color of their old assigned tasks.

Fix: add ``INNER JOIN branch_member bm ON bm.branch_id = t.branch_id AND
bm.user_id = :user_id`` so only tasks in branches the caller still belongs to
are returned. This mirrors ``search_for_chat``'s pattern.

Style: controller-level call (reads request.state.payload), raw-INSERT seeding,
rollback-isolated ``db_session`` fixture.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import my_tasks as ctrl


def _req(user_id: int):
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


async def _add_branch_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by, title="task"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "u": created_by})
    return res.scalar_one()


async def _assign(db, task_id, user_id, role="main"):
    await db.execute(text("""
        INSERT INTO task_assignee (task_id, user_id, role)
        VALUES (:t, :u, :r)
    """), {"t": task_id, "u": user_id, "r": role})


async def _get(user_id, db, status=None, status_category=None, priority=None,
               branch_id=None, sort_by="updated"):
    return await ctrl.get_my_tasks(
        status, status_category, priority, branch_id, sort_by, _req(user_id), db)


# ---------------------------------------------------------------------------
# leak — assigned task in a branch the user was removed from must be hidden
# ---------------------------------------------------------------------------

async def test_assigned_task_hidden_after_branch_membership_removed(db_session):
    """branch에서 제거됐지만 task_assignee가 남은 사용자는 해당 task를 못 본다."""
    alice = await _make_user(db_session, "a@mytasks.test", "a_mt")
    branch = await _make_branch(db_session, alice, name="Secret", key="MT1")
    task = await _make_task(db_session, branch, alice, "Secret Strategy")
    await _assign(db_session, task, alice)
    # alice는 task_assignee에는 남아있지만 branch_member 행이 없다 (제거됨)

    res = await _get(alice, db_session)
    assert res["status"] is True
    assert all(t["task_id"] != task for t in res["tasks"])


# ---------------------------------------------------------------------------
# regression — assigned task in a branch the user is still a member of
# ---------------------------------------------------------------------------

async def test_assigned_task_member_returned_with_metadata(db_session):
    """현재 branch 멤버는 할당된 task를 메타데이터와 함께 정상 반환."""
    alice = await _make_user(db_session, "ok@mytasks.test", "ok_mt")
    branch = await _make_branch(db_session, alice, name="Mine", key="MTOK")
    await _add_branch_member(db_session, branch, alice, "member")
    task = await _make_task(db_session, branch, alice, "My Task")
    await _assign(db_session, task, alice)

    res = await _get(alice, db_session)
    assert res["status"] is True
    matches = [t for t in res["tasks"] if t["task_id"] == task]
    assert len(matches) == 1
    m = matches[0]
    assert m["title"] == "My Task"
    assert m["branch_name"] == "Mine"
    assert m["display_id"] == "MTOK-1"
    assert m["status_label"] == "To Do"


# ---------------------------------------------------------------------------
# cross-branch — only member branches are returned
# ---------------------------------------------------------------------------

async def test_cross_branch_returns_only_member_branch_tasks(db_session):
    """A,B 두 branch에 할당됐지만 A에서만 멤버 → A의 task만 반환."""
    alice = await _make_user(db_session, "x@mytasks.test", "x_mt")

    branch_a = await _make_branch(db_session, alice, name="A", key="MTA")
    await _add_branch_member(db_session, branch_a, alice, "member")
    task_a = await _make_task(db_session, branch_a, alice, "Task A")
    await _assign(db_session, task_a, alice)

    branch_b = await _make_branch(db_session, alice, name="B", key="MTB")
    task_b = await _make_task(db_session, branch_b, alice, "Task B")  # 비멤버
    await _assign(db_session, task_b, alice)

    res = await _get(alice, db_session)
    ids = [t["task_id"] for t in res["tasks"]]
    assert task_a in ids
    assert task_b not in ids


# ---------------------------------------------------------------------------
# filters still work alongside the membership scoping
# ---------------------------------------------------------------------------

async def test_branch_filter_preserved(db_session):
    """branch_id 필터는 멤버십 스코핑과 함께 동작한다."""
    alice = await _make_user(db_session, "f@mytasks.test", "f_mt")

    branch1 = await _make_branch(db_session, alice, name="F1", key="MTF1")
    await _add_branch_member(db_session, branch1, alice, "member")
    t1 = await _make_task(db_session, branch1, alice, "T1")
    await _assign(db_session, t1, alice)

    branch2 = await _make_branch(db_session, alice, name="F2", key="MTF2")
    await _add_branch_member(db_session, branch2, alice, "member")
    t2 = await _make_task(db_session, branch2, alice, "T2")
    await _assign(db_session, t2, alice)

    res = await _get(alice, db_session, branch_id=branch1)
    ids = [t["task_id"] for t in res["tasks"]]
    assert t1 in ids
    assert t2 not in ids
