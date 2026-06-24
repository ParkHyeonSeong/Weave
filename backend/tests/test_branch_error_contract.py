"""branch controller — error-contract tests (SP-1 bulk migration).

Verifies that every error_response() call in branch.py sets code/category/message
(dual-emit) correctly. One representative test per error category present in the cluster:
  - forbidden  : ADMIN_ONLY (non-admin caller)
  - not_found  : BRANCH_NOT_FOUND (detail on unknown branch id)
  - forbidden  : ACCESS_DENIED (private branch, non-member)
  - forbidden  : NOT_BRANCH_MEMBER (update_member_role on non-member target)
  - forbidden  : BRANCH_NOT_PUBLIC (join a private branch)
  - conflict   : ALREADY_MEMBER (join when already a member)
  - conflict   : KEY_ALREADY_EXISTS (create with duplicate key)
  - validation : INVALID_BUCKET (home-stats-items with bad bucket)
  - business   : CANNOT_LEAVE_LAST_ADMIN (leave when sole admin)
  - business   : CANNOT_REMOVE_LAST_ADMIN (remove_member when sole admin)

Seed helpers cribbed verbatim from test_branch_home.py and test_member_email_visibility.py.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import branch as branch_ctrl


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _req(user_id):
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Branch", key="BKEY", visibility="private"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', :v, '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "v": visibility, "u": created_by})
    bid = row.scalar_one()
    for key_, label, color_, category, sort in [
        ("todo",        "To Do",       "#9CA3AF", "todo",        0),
        ("in_progress", "In Progress", "#2563EB", "in_progress", 1),
        ("done",        "Done",        "#16A34A", "done",        2),
        ("cancelled",   "Cancelled",   "#DC2626", "cancelled",   3),
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


# ---------------------------------------------------------------------------
# forbidden — ADMIN_ONLY
# ---------------------------------------------------------------------------

async def test_update_non_admin_returns_admin_only(db_session):
    """update() called by a plain member must return ADMIN_ONLY (forbidden)."""
    admin = await _make_user(db_session, "ba_admin@ec.test", "ba_admin")
    member = await _make_user(db_session, "ba_member@ec.test", "ba_member")
    bid = await _make_branch(db_session, admin, "AdminOnly", "ADMO")
    await _add_member(db_session, bid, admin, "admin")
    await _add_member(db_session, bid, member, "member")

    body = SimpleNamespace(model_dump=lambda exclude_unset=False: {"branch_name": "x"})
    res = await branch_ctrl.update(bid, body, _req(member), db_session)

    assert res["status"] is False
    assert res["code"] == "ADMIN_ONLY"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# not_found — BRANCH_NOT_FOUND
# ---------------------------------------------------------------------------

async def test_get_detail_missing_branch_returns_branch_not_found(db_session):
    """get_detail() on a nonexistent branch_id must return BRANCH_NOT_FOUND (not_found)."""
    user = await _make_user(db_session, "bnf@ec.test", "bnf")
    res = await branch_ctrl.get_detail(999999999, _req(user), db_session)

    assert res["status"] is False
    assert res["code"] == "BRANCH_NOT_FOUND"
    assert res["category"] == "not_found"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# forbidden — ACCESS_DENIED (private branch, non-member)
# ---------------------------------------------------------------------------

async def test_get_detail_private_nonmember_returns_access_denied(db_session):
    """get_detail() on a private branch by a non-member must return ACCESS_DENIED (forbidden)."""
    owner = await _make_user(db_session, "bad_owner@ec.test", "bad_owner")
    stranger = await _make_user(db_session, "bad_stranger@ec.test", "bad_stranger")
    bid = await _make_branch(db_session, owner, "Private", "PRIV", visibility="private")
    await _add_member(db_session, bid, owner, "admin")

    res = await branch_ctrl.get_detail(bid, _req(stranger), db_session)

    assert res["status"] is False
    assert res["code"] == "ACCESS_DENIED"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# forbidden — NOT_BRANCH_MEMBER (update_member_role, target not a member)
# ---------------------------------------------------------------------------

async def test_update_member_role_nonmember_target_returns_not_branch_member(db_session):
    """update_member_role() with a target who is not a member must return NOT_BRANCH_MEMBER."""
    admin = await _make_user(db_session, "umr_admin@ec.test", "umr_admin")
    stranger = await _make_user(db_session, "umr_stranger@ec.test", "umr_stranger")
    bid = await _make_branch(db_session, admin, "RoleB", "ROLB")
    await _add_member(db_session, bid, admin, "admin")

    body = SimpleNamespace(role="member")
    res = await branch_ctrl.update_member_role(bid, stranger, body, _req(admin), db_session)

    assert res["status"] is False
    assert res["code"] == "NOT_BRANCH_MEMBER"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# forbidden — BRANCH_NOT_PUBLIC (join a private branch)
# ---------------------------------------------------------------------------

async def test_join_private_branch_returns_branch_not_public(db_session):
    """join() on a private branch must return BRANCH_NOT_PUBLIC (forbidden)."""
    owner = await _make_user(db_session, "jp_owner@ec.test", "jp_owner")
    joiner = await _make_user(db_session, "jp_joiner@ec.test", "jp_joiner")
    bid = await _make_branch(db_session, owner, "PrivJ", "PRIVJ", visibility="private")
    await _add_member(db_session, bid, owner, "admin")

    res = await branch_ctrl.join(bid, _req(joiner), db_session)

    assert res["status"] is False
    assert res["code"] == "BRANCH_NOT_PUBLIC"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# conflict — ALREADY_MEMBER (join when already a member)
# ---------------------------------------------------------------------------

async def test_join_already_member_returns_already_member(db_session):
    """join() when caller is already a member must return ALREADY_MEMBER (conflict)."""
    owner = await _make_user(db_session, "am_owner@ec.test", "am_owner")
    bid = await _make_branch(db_session, owner, "PubAM", "PUBAM", visibility="public")
    await _add_member(db_session, bid, owner, "admin")

    res = await branch_ctrl.join(bid, _req(owner), db_session)

    assert res["status"] is False
    assert res["code"] == "ALREADY_MEMBER"
    assert res["category"] == "conflict"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# conflict — KEY_ALREADY_EXISTS (create with duplicate key)
# ---------------------------------------------------------------------------

async def test_create_duplicate_key_returns_key_already_exists(db_session):
    """create() with an existing key must return KEY_ALREADY_EXISTS (conflict)."""
    owner = await _make_user(db_session, "kae@ec.test", "kae")
    await _make_branch(db_session, owner, "First", "DUPKEY")

    body = SimpleNamespace(
        branch_name="Second",
        key="DUPKEY",
        description="",
        visibility="private",
    )
    res = await branch_ctrl.create(body, _req(owner), db_session)

    assert res["status"] is False
    assert res["code"] == "KEY_ALREADY_EXISTS"
    assert res["category"] == "conflict"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# validation — INVALID_BUCKET
# ---------------------------------------------------------------------------

async def test_home_stats_items_invalid_bucket_returns_invalid_bucket(db_session):
    """get_home_stats_items() with an unknown bucket must return INVALID_BUCKET (validation)."""
    user = await _make_user(db_session, "ib@ec.test", "ib")
    res = await branch_ctrl.get_home_stats_items(_req(user), "bogus_bucket", 20, db_session)

    assert res["status"] is False
    assert res["code"] == "INVALID_BUCKET"
    assert res["category"] == "validation"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# business — CANNOT_LEAVE_LAST_ADMIN
# ---------------------------------------------------------------------------

async def test_leave_last_admin_returns_cannot_leave_last_admin(db_session):
    """leave() when caller is the sole admin must return CANNOT_LEAVE_LAST_ADMIN (business)."""
    admin = await _make_user(db_session, "clla@ec.test", "clla")
    bid = await _make_branch(db_session, admin, "LeaveB", "LVEB")
    await _add_member(db_session, bid, admin, "admin")

    res = await branch_ctrl.leave(bid, _req(admin), db_session)

    assert res["status"] is False
    assert res["code"] == "CANNOT_LEAVE_LAST_ADMIN"
    assert res["category"] == "business"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# business — CANNOT_REMOVE_LAST_ADMIN
# ---------------------------------------------------------------------------

async def test_remove_member_last_admin_returns_cannot_remove_last_admin(db_session):
    """remove_member() targeting the sole admin must return CANNOT_REMOVE_LAST_ADMIN (business)."""
    admin = await _make_user(db_session, "crla@ec.test", "crla")
    bid = await _make_branch(db_session, admin, "RemoveB", "REMB")
    await _add_member(db_session, bid, admin, "admin")

    res = await branch_ctrl.remove_member(bid, admin, _req(admin), db_session)

    assert res["status"] is False
    assert res["code"] == "CANNOT_REMOVE_LAST_ADMIN"
    assert res["category"] == "business"
    assert res["retryable"] is False
    assert res["message"] == res["code"]
