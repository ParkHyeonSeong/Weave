"""Error-contract tests for the branch-config cluster (SP-2 migration).

Covers: label.py, task_type_config.py, custom_field.py, workflow_status.py

One representative test per error CATEGORY present in the cluster:
  - forbidden  → NOT_BRANCH_MEMBER (label.get_list, non-member caller)
  - forbidden  → ADMIN_ONLY (task_type_config.create, member-not-admin caller)
  - not_found  → LABEL_NOT_FOUND (label.update, unknown label_id)
  - conflict   → LABEL_ALREADY_EXISTS (label.create, duplicate name)
  - business   → CANNOT_DELETE_LAST_STATUS (workflow_status.delete_status, single status left)

Each assertion checks res["code"], res["category"], and res["message"]==res["code"]
(dual-emit) to verify the error_response wrapper was applied.

Seed helpers are cribbed verbatim from test_idor_custom_field.py and
test_idor_workflow_status.py so that column names match the real schema.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import label as label_ctrl
from core.controller import task_type_config as ttc_ctrl
from core.controller import workflow_status as ws_ctrl


def _req(user_id: int):
    """Mimic request.state.payload as the controllers read it."""
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id}))


# ---------------------------------------------------------------------------
# Seed helpers — cribbed verbatim from test_idor_custom_field.py
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


# Seed a single workflow_status row so delete tests can target it.
# Cribbed from test_idor_workflow_status.py _make_branch loop.
async def _make_status(db, branch_id, key="todo", label="To Do"):
    row = await db.execute(text("""
        INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order)
        VALUES (:b, :k, :l, '#9CA3AF', 'todo', 0)
        RETURNING workflow_status_id
    """), {"b": branch_id, "k": key, "l": label})
    return row.scalar_one()


# ---------------------------------------------------------------------------
# 1. forbidden — NOT_BRANCH_MEMBER (label.get_list, non-member caller)
# ---------------------------------------------------------------------------

async def test_label_get_list_non_member_returns_not_branch_member(db_session):
    """Non-member caller → NOT_BRANCH_MEMBER (forbidden category, dual-emit)."""
    owner = await _make_user(db_session, "owner_lbl@bcfg.test", "owner_lbl")
    stranger = await _make_user(db_session, "stranger_lbl@bcfg.test", "stranger_lbl")
    branch = await _make_branch(db_session, owner, name="LblBranch", key="LBLB1")
    await _add_member(db_session, branch, owner, "admin")
    # stranger is NOT added as a member

    res = await label_ctrl.get_list(branch, _req(stranger), db_session)

    assert res["status"] is False
    assert res["code"] == "NOT_BRANCH_MEMBER"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


# ---------------------------------------------------------------------------
# 2. forbidden — ADMIN_ONLY (task_type_config.create, member-not-admin caller)
# ---------------------------------------------------------------------------

async def test_task_type_create_non_admin_returns_admin_only(db_session):
    """Member (role=member, not admin) → ADMIN_ONLY (forbidden category, dual-emit)."""
    owner = await _make_user(db_session, "owner_ttc@bcfg.test", "owner_ttc")
    plain = await _make_user(db_session, "plain_ttc@bcfg.test", "plain_ttc")
    branch = await _make_branch(db_session, owner, name="TtcBranch", key="TTCB1")
    await _add_member(db_session, branch, owner, "admin")
    await _add_member(db_session, branch, plain, "member")

    body = SimpleNamespace(
        type_key="feature",
        type_name="Feature",
        icon="Star",
        color="#6B7280",
    )
    res = await ttc_ctrl.create(branch, body, _req(plain), db_session)

    assert res["status"] is False
    assert res["code"] == "ADMIN_ONLY"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


# ---------------------------------------------------------------------------
# 3. not_found — LABEL_NOT_FOUND (label.update, non-existent label_id)
# ---------------------------------------------------------------------------

async def test_label_update_nonexistent_returns_label_not_found(db_session):
    """Updating a label_id that does not belong to the branch → LABEL_NOT_FOUND (not_found, dual-emit)."""
    owner = await _make_user(db_session, "owner_lnf@bcfg.test", "owner_lnf")
    branch = await _make_branch(db_session, owner, name="LnfBranch", key="LNFB1")
    await _add_member(db_session, branch, owner, "admin")

    body = SimpleNamespace(label_name="Ghost", color="#000000")
    res = await label_ctrl.update(9999999, body, branch, _req(owner), db_session)

    assert res["status"] is False
    assert res["code"] == "LABEL_NOT_FOUND"
    assert res["category"] == "not_found"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


# ---------------------------------------------------------------------------
# 4. conflict — LABEL_ALREADY_EXISTS (label.create, duplicate)
# ---------------------------------------------------------------------------

async def test_label_create_duplicate_returns_label_already_exists(db_session):
    """Creating two labels with the same name in a branch → LABEL_ALREADY_EXISTS (conflict, dual-emit)."""
    owner = await _make_user(db_session, "owner_lae@bcfg.test", "owner_lae")
    branch = await _make_branch(db_session, owner, name="LaeBranch", key="LAEB1")
    await _add_member(db_session, branch, owner, "admin")

    body = SimpleNamespace(label_name="Duplicate", color="#FF0000")
    first = await label_ctrl.create(body, branch, _req(owner), db_session)
    assert first["status"] is True

    res = await label_ctrl.create(body, branch, _req(owner), db_session)

    assert res["status"] is False
    assert res["code"] == "LABEL_ALREADY_EXISTS"
    assert res["category"] == "conflict"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


# ---------------------------------------------------------------------------
# 5. business — CANNOT_DELETE_LAST_STATUS (workflow_status.delete_status)
# ---------------------------------------------------------------------------

async def test_ws_delete_last_status_returns_cannot_delete_last_status(db_session):
    """Deleting the only remaining workflow status → CANNOT_DELETE_LAST_STATUS (business, dual-emit)."""
    owner = await _make_user(db_session, "owner_wsdl@bcfg.test", "owner_wsdl")
    branch = await _make_branch(db_session, owner, name="WsdlBranch", key="WSDLB1")
    await _add_member(db_session, branch, owner, "admin")
    status_id = await _make_status(db_session, branch, key="solo", label="Solo")

    res = await ws_ctrl.delete_status(branch, status_id, _req(owner), db_session)

    assert res["status"] is False
    assert res["code"] == "CANNOT_DELETE_LAST_STATUS"
    assert res["category"] == "business"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit
