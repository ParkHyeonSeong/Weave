"""IDOR regression tests for workflow_status update/reorder (SEC-01).

Style: direct controller-level calls (no HTTP client), seeding with raw INSERTs
via the rollback-isolated ``db_session`` fixture. See test_track_home.py /
test_controller_scrum_board.py for the shared pattern.

Gap: ``update_status`` and ``reorder_statuses`` checked only branch-admin role
and never verified that the target status_id(s) belonged to that branch — a
branch-1 admin could mutate branch-2 workflow statuses by supplying a foreign
status_id. The canonical safe pattern lives in ``delete_status``.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import workflow_status as ctrl
from routers.schema import workflow_status as schema


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
    """Create a branch and seed its 4 default workflow statuses."""
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


async def _statuses(db, branch_id):
    res = await db.execute(text("""
        SELECT workflow_status_id, label, sort_order
        FROM workflow_status
        WHERE branch_id = :b
        ORDER BY sort_order, workflow_status_id
    """), {"b": branch_id})
    return [dict(r._mapping) for r in res.fetchall()]


# ---------------------------------------------------------------------------
# update_status — cross-branch IDOR
# ---------------------------------------------------------------------------

async def test_update_status_rejects_cross_branch(db_session):
    """branch-1 admin이 branch-2 소속 status_id를 수정 시도 → STATUS_NOT_FOUND."""
    alice = await _make_user(db_session, "alice@idor.test", "alice")
    bob = await _make_user(db_session, "bob@idor.test", "bob")

    branch1 = await _make_branch(db_session, alice, name="B1", key="IUB1")
    await _add_member(db_session, branch1, alice, "admin")

    branch2 = await _make_branch(db_session, bob, name="B2", key="IUB2")
    await _add_member(db_session, branch2, bob, "admin")

    b2_before = await _statuses(db_session, branch2)
    victim_id = b2_before[0]["workflow_status_id"]
    victim_label = b2_before[0]["label"]

    # alice(branch1 admin)가 branch1 컨텍스트에서 branch2의 status를 수정 시도
    res = await ctrl.update_status(
        branch1, victim_id,
        schema.WorkflowStatusUpdate(label="Hacked"),
        _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "STATUS_NOT_FOUND"

    # branch2의 status는 그대로여야 함
    b2_after = await _statuses(db_session, branch2)
    after = next(s for s in b2_after if s["workflow_status_id"] == victim_id)
    assert after["label"] == victim_label


# ---------------------------------------------------------------------------
# reorder_statuses — cross-branch IDOR
# ---------------------------------------------------------------------------

async def test_reorder_rejects_cross_branch_item(db_session):
    """reorder items에 다른 branch의 id가 섞이면 전부 거부 + 변경 없음."""
    alice = await _make_user(db_session, "alice_ro@idor.test", "alice_ro")
    bob = await _make_user(db_session, "bob_ro@idor.test", "bob_ro")

    branch1 = await _make_branch(db_session, alice, name="B1", key="IRB1")
    await _add_member(db_session, branch1, alice, "admin")

    branch2 = await _make_branch(db_session, bob, name="B2", key="IRB2")
    await _add_member(db_session, branch2, bob, "admin")

    b1 = await _statuses(db_session, branch1)
    b2 = await _statuses(db_session, branch2)
    b2_orders_before = {s["workflow_status_id"]: s["sort_order"] for s in b2}

    # 한 개는 정상(branch1 소속), 한 개는 branch2 소속(cross-branch)으로 섞는다
    body = schema.WorkflowStatusReorder(items=[
        {"id": b1[0]["workflow_status_id"], "sort_order": 99},
        {"id": b2[0]["workflow_status_id"], "sort_order": 98},
    ])
    res = await ctrl.reorder_statuses(branch1, body, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "STATUS_NOT_FOUND"

    # branch2 순서는 변하지 않아야 한다
    b2_after = await _statuses(db_session, branch2)
    for s in b2_after:
        assert s["sort_order"] == b2_orders_before[s["workflow_status_id"]]

    # 거부됐으므로 branch1의 정상 item도 적용되지 않아야 한다 (all-or-nothing)
    b1_after = await _statuses(db_session, branch1)
    b1_target = next(s for s in b1_after if s["workflow_status_id"] == b1[0]["workflow_status_id"])
    assert b1_target["sort_order"] == b1[0]["sort_order"]


# ---------------------------------------------------------------------------
# regression — same-branch admin happy paths still work
# ---------------------------------------------------------------------------

async def test_update_status_same_branch_admin_succeeds(db_session):
    alice = await _make_user(db_session, "alice_ok@idor.test", "alice_ok")
    branch1 = await _make_branch(db_session, alice, name="B1", key="OKB1")
    await _add_member(db_session, branch1, alice, "admin")

    statuses = await _statuses(db_session, branch1)
    target_id = statuses[0]["workflow_status_id"]

    res = await ctrl.update_status(
        branch1, target_id,
        schema.WorkflowStatusUpdate(label="Renamed"),
        _req(alice), db_session,
    )
    assert res["status"] is True

    after = await _statuses(db_session, branch1)
    target = next(s for s in after if s["workflow_status_id"] == target_id)
    assert target["label"] == "Renamed"


async def test_reorder_same_branch_admin_succeeds(db_session):
    alice = await _make_user(db_session, "alice_okro@idor.test", "alice_okro")
    branch1 = await _make_branch(db_session, alice, name="B1", key="OKRO1")
    await _add_member(db_session, branch1, alice, "admin")

    statuses = await _statuses(db_session, branch1)
    first, second = statuses[0], statuses[1]

    body = schema.WorkflowStatusReorder(items=[
        {"id": first["workflow_status_id"], "sort_order": 50},
        {"id": second["workflow_status_id"], "sort_order": 51},
    ])
    res = await ctrl.reorder_statuses(branch1, body, _req(alice), db_session)
    assert res["status"] is True

    after = {s["workflow_status_id"]: s["sort_order"] for s in await _statuses(db_session, branch1)}
    assert after[first["workflow_status_id"]] == 50
    assert after[second["workflow_status_id"]] == 51
