"""IDOR regression tests for task_type_config update (SEC-15).

Style: direct controller-level calls (no HTTP client), seeding with raw INSERTs
via the rollback-isolated ``db_session`` fixture. See test_idor_workflow_status.py
/ test_controller_scrum_board.py for the shared pattern.

Gap: ``update`` checked only branch-admin role and never verified that the
target type_id belonged to that branch — a branch-1 admin could mutate
branch-2 task types by supplying a foreign type_id. The canonical safe pattern
lives in ``delete`` (find_by_branch -> not-found -> TYPE_NOT_FOUND).
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task_type_config as ctrl
from routers.schema import task_type_config as schema


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
    """Create a branch and seed its 3 default task types."""
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    bid = row.scalar_one()
    for type_key, type_name, icon, color, sort in [
        ("task", "Task", "CheckSquare", "#5E6AD2", 0),
        ("bug", "Bug", "Bug", "#DC2626", 1),
        ("story", "Story", "BookOpen", "#16A34A", 2),
    ]:
        await db.execute(text("""
            INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
            VALUES (:b, :k, :n, :i, :c, :s)
        """), {"b": bid, "k": type_key, "n": type_name, "i": icon, "c": color, "s": sort})
    return bid


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _types(db, branch_id):
    res = await db.execute(text("""
        SELECT type_id, type_key, type_name, sort_order
        FROM task_type_config
        WHERE branch_id = :b
        ORDER BY sort_order, type_id
    """), {"b": branch_id})
    return [dict(r._mapping) for r in res.fetchall()]


# ---------------------------------------------------------------------------
# update — cross-branch IDOR
# ---------------------------------------------------------------------------

async def test_update_rejects_cross_branch(db_session):
    """branch-1 admin이 branch-2 소속 type_id를 수정 시도 → TYPE_NOT_FOUND."""
    alice = await _make_user(db_session, "alice@idor.tt", "alice_tt")
    bob = await _make_user(db_session, "bob@idor.tt", "bob_tt")

    branch1 = await _make_branch(db_session, alice, name="B1", key="ITT1")
    await _add_member(db_session, branch1, alice, "admin")

    branch2 = await _make_branch(db_session, bob, name="B2", key="ITT2")
    await _add_member(db_session, branch2, bob, "admin")

    b2_before = await _types(db_session, branch2)
    victim_id = b2_before[0]["type_id"]
    victim_name = b2_before[0]["type_name"]

    # alice(branch1 admin)가 branch1 컨텍스트에서 branch2의 type을 수정 시도
    res = await ctrl.update(
        branch1, victim_id,
        schema.TaskTypeUpdate(type_name="Hacked"),
        _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "TYPE_NOT_FOUND"

    # branch2의 task type은 그대로여야 함
    b2_after = await _types(db_session, branch2)
    after = next(t for t in b2_after if t["type_id"] == victim_id)
    assert after["type_name"] == victim_name


# ---------------------------------------------------------------------------
# regression — same-branch admin happy path still works
# ---------------------------------------------------------------------------

async def test_update_same_branch_admin_succeeds(db_session):
    alice = await _make_user(db_session, "alice_ok@idor.tt", "alice_ok_tt")
    branch1 = await _make_branch(db_session, alice, name="B1", key="OKTT1")
    await _add_member(db_session, branch1, alice, "admin")

    types = await _types(db_session, branch1)
    target_id = types[0]["type_id"]

    res = await ctrl.update(
        branch1, target_id,
        schema.TaskTypeUpdate(type_name="Renamed"),
        _req(alice), db_session,
    )
    assert res["status"] is True

    after = await _types(db_session, branch1)
    target = next(t for t in after if t["type_id"] == target_id)
    assert target["type_name"] == "Renamed"
