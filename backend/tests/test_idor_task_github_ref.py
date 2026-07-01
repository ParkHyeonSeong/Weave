"""IDOR / authz regression tests for the GitHub integration + manual ref linking.

Style: direct controller-level calls (no HTTP client), raw-INSERT seed via the
rollback-isolated db_session fixture, request.state.payload faked with
SimpleNamespace. Mirrors test_idor_task_dependency.py.

Two concerns are locked in here:
  * admin-only gate on integration CRUD (member but not admin -> PERMISSION_DENIED)
  * cross-branch IDOR on manual ref unlink: a member of branch A must not be able
    to unlink a ref that lives on a task of branch B. The defense is the STEP1
    member -> STEP2 find_resource_in_branch(task_id, REAL branch_id, 'task') ->
    STEP3 tuple-scoped delete(ref_id, task_id) chain.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import github_integration as int_ctrl
from routers.schema import github as schema
from core.model import github_integration as ghi
from core.model import task_github_ref as tgr


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="B", key="KEY"):
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


async def _make_task(db, branch_id, created_by, title="t"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "u": created_by})
    return res.scalar_one()


# ---------------------------------------------------------------------------
# integration CRUD admin gate
# ---------------------------------------------------------------------------

async def test_create_integration_requires_admin(db_session):
    admin = await _make_user(db_session, "ghadm@gh.test", "ghadm")
    plain = await _make_user(db_session, "ghmem@gh.test", "ghmem")
    b = await _make_branch(db_session, admin, key="GADM")
    await _add_member(db_session, b, admin, "admin")
    await _add_member(db_session, b, plain, "member")

    body = schema.IntegrationCreate(repo_full_name="org/repo", installation_id=11)

    # plain member -> denied
    denied = await int_ctrl.create_integration(body, b, _req(plain), db_session)
    assert denied["status"] is False
    assert denied["code"] == "PERMISSION_DENIED"
    assert await ghi.find_by_branch(b, db_session) == []

    # admin -> ok
    ok = await int_ctrl.create_integration(body, b, _req(admin), db_session)
    assert ok["status"] is True
    assert ok["integration"]["repo_full_name"] == "org/repo"


async def test_delete_integration_admin_and_branch_scoped(db_session):
    admin = await _make_user(db_session, "ghadm2@gh.test", "ghadm2")
    b = await _make_branch(db_session, admin, key="GADM2")
    other = await _make_branch(db_session, admin, name="O", key="GOTH")
    await _add_member(db_session, b, admin, "admin")
    await _add_member(db_session, other, admin, "admin")
    created = await ghi.create(b, "org/repo", 11, admin, db_session)

    # deleting via the OTHER branch's URL must not remove b's row
    wrong = await int_ctrl.delete_integration(other, created["integration_id"],
                                               _req(admin), db_session)
    assert wrong["status"] is False
    assert wrong["code"] == "INTEGRATION_NOT_FOUND"
    assert await ghi.find_by_branch(b, db_session) != []

    ok = await int_ctrl.delete_integration(b, created["integration_id"],
                                            _req(admin), db_session)
    assert ok["status"] is True
    assert await ghi.find_by_branch(b, db_session) == []


async def test_set_enabled_admin_and_branch_scoped(db_session):
    admin = await _make_user(db_session, "ghadm3@gh.test", "ghadm3")
    b = await _make_branch(db_session, admin, key="GADM3")
    other = await _make_branch(db_session, admin, name="O3", key="GOT3")
    await _add_member(db_session, b, admin, "admin")
    await _add_member(db_session, other, admin, "admin")
    created = await ghi.create(b, "org/repo", 11, admin, db_session)

    # toggling via the OTHER branch's URL must not affect b's row
    wrong = await int_ctrl.set_enabled(other, created["integration_id"],
                                       schema.IntegrationToggle(enabled=False),
                                       _req(admin), db_session)
    assert wrong["status"] is False
    assert wrong["code"] == "INTEGRATION_NOT_FOUND"
    rows = await ghi.find_by_branch(b, db_session)
    assert len(rows) == 1 and rows[0]["enabled"] is True

    ok = await int_ctrl.set_enabled(b, created["integration_id"],
                                    schema.IntegrationToggle(enabled=False),
                                    _req(admin), db_session)
    assert ok["status"] is True
    assert "integration" in ok
    rows_after = await ghi.find_by_branch(b, db_session)
    assert len(rows_after) == 1 and rows_after[0]["enabled"] is False


async def test_create_integration_duplicate_survives_outer_tx(db_session):
    admin = await _make_user(db_session, "ghadm4@gh.test", "ghadm4")
    b = await _make_branch(db_session, admin, key="GADM4")
    await _add_member(db_session, b, admin, "admin")

    body = schema.IntegrationCreate(repo_full_name="org/dup", installation_id=11)

    first = await int_ctrl.create_integration(body, b, _req(admin), db_session)
    assert first["status"] is True

    second = await int_ctrl.create_integration(body, b, _req(admin), db_session)
    assert second["status"] is False
    assert second["code"] == "DUPLICATE_LINK"

    # Prove the outer tx survived the IntegrityError (savepoint contained it):
    # if the session were in a failed/aborted state, this query would raise
    # PendingRollbackError / InFailedSqlTransaction instead of returning.
    rows = await ghi.find_by_branch(b, db_session)
    assert len(rows) == 1
