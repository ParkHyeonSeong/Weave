"""IDOR regression tests for custom_field reorder (SEC-08).

Style: direct controller-level calls (no HTTP client), seeding with raw INSERTs
via the rollback-isolated ``db_session`` fixture. See test_idor_workflow_status.py
for the sibling SEC-01 pattern this mirrors.

Gap: ``reorder_fields`` checked only branch-admin role and never verified that
(a) the supplied ``type_id`` belonged to that branch, nor (b) that every
``item['id']`` in the reorder body belonged to that type. A branch-1 admin could
therefore mutate the sort_order of another branch/type's custom fields by
supplying foreign field ids. The canonical safe pattern (set-membership,
all-or-nothing) lives in ``reorder_statuses`` / ``delete_field``.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import custom_field as ctrl
from routers.schema import custom_field as schema


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
    return row.scalar_one()


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_type(db, branch_id, type_key="task", type_name="Task"):
    row = await db.execute(text("""
        INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
        VALUES (:b, :k, :n, 'CheckSquare', '#5E6AD2', 0)
        RETURNING type_id
    """), {"b": branch_id, "k": type_key, "n": type_name})
    return row.scalar_one()


async def _make_field(db, type_id, field_name="Field", field_type="text", sort_order=0):
    row = await db.execute(text("""
        INSERT INTO custom_field (type_id, field_name, field_type, is_required, sort_order)
        VALUES (:t, :f, :ft, false, :so)
        RETURNING custom_field_id
    """), {"t": type_id, "f": field_name, "ft": field_type, "so": sort_order})
    return row.scalar_one()


async def _fields(db, type_id):
    res = await db.execute(text("""
        SELECT custom_field_id, type_id, sort_order
        FROM custom_field
        WHERE type_id = :t
        ORDER BY sort_order, custom_field_id
    """), {"t": type_id})
    return [dict(r._mapping) for r in res.fetchall()]


async def _field_row(db, field_id):
    res = await db.execute(text("""
        SELECT custom_field_id, type_id, field_name, field_type, is_required, sort_order
        FROM custom_field
        WHERE custom_field_id = :f
    """), {"f": field_id})
    row = res.fetchone()
    return dict(row._mapping) if row else None


# ---------------------------------------------------------------------------
# reorder_fields — cross-type/branch IDOR (mixed item)
# ---------------------------------------------------------------------------

async def test_reorder_rejects_cross_branch_field_item(db_session):
    """reorder items에 다른 branch/type의 field_id가 섞이면 전부 거부 + 변경 없음."""
    alice = await _make_user(db_session, "alice_cf@idor.test", "alice_cf")
    bob = await _make_user(db_session, "bob_cf@idor.test", "bob_cf")

    branch1 = await _make_branch(db_session, alice, name="B1", key="CFB1")
    await _add_member(db_session, branch1, alice, "admin")
    type1 = await _make_type(db_session, branch1, "task", "Task")
    f1a = await _make_field(db_session, type1, "F1a", "text", 0)
    f1b = await _make_field(db_session, type1, "F1b", "text", 1)

    branch2 = await _make_branch(db_session, bob, name="B2", key="CFB2")
    await _add_member(db_session, branch2, bob, "admin")
    type2 = await _make_type(db_session, branch2, "bug", "Bug")
    f2a = await _make_field(db_session, type2, "F2a", "text", 0)

    b2_before = {f["custom_field_id"]: f["sort_order"] for f in await _fields(db_session, type2)}

    # 한 개는 정상(type1 소속), 한 개는 type2 소속(cross-branch)으로 섞는다
    body = schema.CustomFieldReorder(items=[
        {"id": f1a, "sort_order": 99},
        {"id": f2a, "sort_order": 98},  # ← branch2/type2의 field!
    ])
    res = await ctrl.reorder_fields(branch1, type1, body, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "FIELD_NOT_FOUND"

    # branch2/type2 field의 순서는 변하지 않아야 한다
    b2_after = {f["custom_field_id"]: f["sort_order"] for f in await _fields(db_session, type2)}
    assert b2_after == b2_before

    # 거부됐으므로 type1의 정상 item도 적용되지 않아야 한다 (all-or-nothing)
    b1_after = {f["custom_field_id"]: f["sort_order"] for f in await _fields(db_session, type1)}
    assert b1_after[f1a] == 0
    assert b1_after[f1b] == 1


# ---------------------------------------------------------------------------
# reorder_fields — cross-branch type_id
# ---------------------------------------------------------------------------

async def test_reorder_rejects_cross_branch_type(db_session):
    """branch1 admin이 branch1 컨텍스트에서 branch2 소속 type_id로 reorder → TYPE_NOT_FOUND."""
    alice = await _make_user(db_session, "alice_cft@idor.test", "alice_cft")
    bob = await _make_user(db_session, "bob_cft@idor.test", "bob_cft")

    branch1 = await _make_branch(db_session, alice, name="B1", key="CFTB1")
    await _add_member(db_session, branch1, alice, "admin")

    branch2 = await _make_branch(db_session, bob, name="B2", key="CFTB2")
    await _add_member(db_session, branch2, bob, "admin")
    type2 = await _make_type(db_session, branch2, "bug", "Bug")
    f2a = await _make_field(db_session, type2, "F2a", "text", 0)

    b2_before = {f["custom_field_id"]: f["sort_order"] for f in await _fields(db_session, type2)}

    # alice는 branch1 admin이지만, branch2 소속 type2를 branch1 컨텍스트로 지정
    body = schema.CustomFieldReorder(items=[{"id": f2a, "sort_order": 99}])
    res = await ctrl.reorder_fields(branch1, type2, body, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "TYPE_NOT_FOUND"

    # branch2/type2 field의 순서는 변하지 않아야 한다
    b2_after = {f["custom_field_id"]: f["sort_order"] for f in await _fields(db_session, type2)}
    assert b2_after == b2_before


# ---------------------------------------------------------------------------
# regression — same-branch admin happy path still works
# ---------------------------------------------------------------------------

async def test_reorder_same_type_admin_succeeds(db_session):
    alice = await _make_user(db_session, "alice_cfok@idor.test", "alice_cfok")
    branch1 = await _make_branch(db_session, alice, name="B1", key="CFOK1")
    await _add_member(db_session, branch1, alice, "admin")
    type1 = await _make_type(db_session, branch1, "task", "Task")
    f1a = await _make_field(db_session, type1, "F1a", "text", 0)
    f1b = await _make_field(db_session, type1, "F1b", "text", 1)

    body = schema.CustomFieldReorder(items=[
        {"id": f1a, "sort_order": 50},
        {"id": f1b, "sort_order": 51},
    ])
    res = await ctrl.reorder_fields(branch1, type1, body, _req(alice), db_session)
    assert res["status"] is True

    after = {f["custom_field_id"]: f["sort_order"] for f in await _fields(db_session, type1)}
    assert after[f1a] == 50
    assert after[f1b] == 51


# ---------------------------------------------------------------------------
# update_field / delete_field — cross-branch type_id (sibling of SEC-08)
# ---------------------------------------------------------------------------

async def test_update_field_rejects_cross_branch_type(db_session):
    """branch1 admin이 branch2 소속 type/field를 branch1 컨텍스트로 수정 시도 → TYPE_NOT_FOUND, 변경 없음."""
    alice = await _make_user(db_session, "alice_upx@idor.test", "alice_upx")
    bob = await _make_user(db_session, "bob_upx@idor.test", "bob_upx")

    branch1 = await _make_branch(db_session, alice, name="B1", key="UPXB1")
    await _add_member(db_session, branch1, alice, "admin")

    branch2 = await _make_branch(db_session, bob, name="B2", key="UPXB2")
    await _add_member(db_session, branch2, bob, "admin")
    type2 = await _make_type(db_session, branch2, "bug", "Bug")
    f2a = await _make_field(db_session, type2, "F2a", "text", 0)

    before = await _field_row(db_session, f2a)

    # alice는 branch1 admin이지만, branch2 소속 type2/f2a를 branch1 컨텍스트로 지정
    body = schema.CustomFieldUpdate(field_name="HACKED", is_required=True)
    res = await ctrl.update_field(branch1, type2, f2a, body, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "TYPE_NOT_FOUND"

    # branch2/type2의 field는 변하지 않아야 한다
    after = await _field_row(db_session, f2a)
    assert after == before


async def test_delete_field_rejects_cross_branch_type(db_session):
    """branch1 admin이 branch2 소속 type/field를 branch1 컨텍스트로 삭제 시도 → TYPE_NOT_FOUND, 존재 유지."""
    alice = await _make_user(db_session, "alice_delx@idor.test", "alice_delx")
    bob = await _make_user(db_session, "bob_delx@idor.test", "bob_delx")

    branch1 = await _make_branch(db_session, alice, name="B1", key="DELXB1")
    await _add_member(db_session, branch1, alice, "admin")

    branch2 = await _make_branch(db_session, bob, name="B2", key="DELXB2")
    await _add_member(db_session, branch2, bob, "admin")
    type2 = await _make_type(db_session, branch2, "bug", "Bug")
    f2a = await _make_field(db_session, type2, "F2a", "text", 0)

    before = await _field_row(db_session, f2a)

    res = await ctrl.delete_field(branch1, type2, f2a, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "TYPE_NOT_FOUND"

    # branch2/type2의 field는 여전히 존재해야 한다
    after = await _field_row(db_session, f2a)
    assert after is not None
    assert after == before


# ---------------------------------------------------------------------------
# regression — same-branch admin can still update + delete its own field
# ---------------------------------------------------------------------------

async def test_update_delete_same_branch_admin_succeeds(db_session):
    alice = await _make_user(db_session, "alice_udok@idor.test", "alice_udok")
    branch1 = await _make_branch(db_session, alice, name="B1", key="UDOK1")
    await _add_member(db_session, branch1, alice, "admin")
    type1 = await _make_type(db_session, branch1, "task", "Task")
    f1a = await _make_field(db_session, type1, "F1a", "text", 0)

    # update happy path
    body = schema.CustomFieldUpdate(field_name="Renamed", is_required=True)
    res = await ctrl.update_field(branch1, type1, f1a, body, _req(alice), db_session)
    assert res["status"] is True
    row = await _field_row(db_session, f1a)
    assert row["field_name"] == "Renamed"
    assert row["is_required"] is True

    # delete happy path
    res = await ctrl.delete_field(branch1, type1, f1a, _req(alice), db_session)
    assert res["status"] is True
    assert await _field_row(db_session, f1a) is None
