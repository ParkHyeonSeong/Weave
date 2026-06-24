"""Controller-level error-envelope tests for saved_view.

Verifies that every failure path returns the unified error_response shape:
  {status: False, code: X, message: X (dual-emit), category: ..., retryable: False}
after the migration of backend/core/controller/saved_view.py.

Seed helpers are cribbed verbatim from backend/tests/test_saved_view_api.py.
"""

from types import SimpleNamespace
from sqlalchemy import text

from core.controller import saved_view as ctrl
from routers.schema.saved_view import SavedViewCreate, SavedViewUpdate

# ---------------------------------------------------------------------------
# Seed helpers (verbatim from test_saved_view_api.py)
# ---------------------------------------------------------------------------

def _req(uid):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': uid}))


async def _user(db, e, u):
    r = await db.execute(
        text('INSERT INTO "user" (email,password,username,status) VALUES (:e,:p,:u,\'active\') RETURNING user_id'),
        {'e': e, 'p': b'x', 'u': u}
    )
    return r.scalar_one()


async def _branch(db, uid, key, member=None):
    r = await db.execute(
        text("INSERT INTO branch (branch_name,key,description,visibility,color,created_by)"
             " VALUES ('b',:k,'d','private','#5E6AD2',:u) RETURNING branch_id"),
        {'k': key, 'u': uid}
    )
    bid = r.scalar_one()
    await db.execute(
        text("INSERT INTO branch_member (branch_id,user_id,role) VALUES (:b,:u,'admin')"),
        {'b': bid, 'u': uid}
    )
    if member:
        await db.execute(
            text("INSERT INTO branch_member (branch_id,user_id,role) VALUES (:b,:u,'member')"),
            {'b': bid, 'u': member}
        )
    return bid


_SPEC = {'type': 'group', 'op': 'AND', 'negate': False, 'children': []}

# ---------------------------------------------------------------------------
# Uniform assertion helper (REQUIRED — same shape across all migration tasks)
# ---------------------------------------------------------------------------

def _assert_error(res, code, category, retryable=False):
    assert res["status"] is False
    assert res["code"] == code
    assert res["category"] == category
    assert res["message"] == res["code"]   # dual-emit
    assert res["retryable"] is retryable

# ---------------------------------------------------------------------------
# Tests — one per distinct category present in saved_view failure paths
# ---------------------------------------------------------------------------

# --- FORBIDDEN: NOT_BRANCH_MEMBER -------------------------------------------

async def test_error_not_branch_member_on_create(db_session):
    """create() returns forbidden envelope when caller is not a branch member."""
    alice = await _user(db_session, 'a@cse.test', 'alice_cse')
    bob   = await _user(db_session, 'b@cse.test', 'bob_cse')
    bid   = await _branch(db_session, alice, 'CSENBM')  # bob is NOT a member

    res = await ctrl.create(
        SavedViewCreate(name='x', scope_branch_id=bid, filter_spec=_SPEC),
        _req(bob),
        db_session,
    )
    _assert_error(res, "NOT_BRANCH_MEMBER", "forbidden")


# --- FORBIDDEN: NOT_VIEW_OWNER ----------------------------------------------

async def test_error_not_view_owner_on_update(db_session):
    """update() returns forbidden envelope when caller is a member but not the owner."""
    owner    = await _user(db_session, 'own@cse.test', 'owner_cse')
    intruder = await _user(db_session, 'int@cse.test', 'intruder_cse')
    bid      = await _branch(db_session, owner, 'CSENVO', member=intruder)

    vid = (await ctrl.create(
        SavedViewCreate(name='V', scope_branch_id=bid, filter_spec=_SPEC, visibility='shared'),
        _req(owner),
        db_session,
    ))['view_id']

    res = await ctrl.update(vid, SavedViewUpdate(name='hax'), _req(intruder), db_session)
    _assert_error(res, "NOT_VIEW_OWNER", "forbidden")


# --- NOT_FOUND: VIEW_NOT_FOUND ----------------------------------------------

async def test_error_view_not_found_on_get_detail(db_session):
    """get_detail() returns not_found envelope for a nonexistent view_id."""
    uid = await _user(db_session, 'nf@cse.test', 'nf_cse')

    res = await ctrl.get_detail(999999999, _req(uid), db_session)
    _assert_error(res, "VIEW_NOT_FOUND", "not_found")


# --- VALIDATION: INVALID_VISIBILITY -----------------------------------------

async def test_error_invalid_visibility_on_create(db_session):
    """create() returns validation envelope for an unrecognised visibility value."""
    uid = await _user(db_session, 'iv@cse.test', 'iv_cse')
    bid = await _branch(db_session, uid, 'CSEIV')

    res = await ctrl.create(
        SavedViewCreate(name='bad', scope_branch_id=bid, filter_spec=_SPEC, visibility='public'),
        _req(uid),
        db_session,
    )
    _assert_error(res, "INVALID_VISIBILITY", "validation")


# --- VALIDATION: INVALID_FILTER (with detail extra-field) -------------------

async def test_error_invalid_filter_preserves_detail(db_session):
    """create() returns validation envelope + preserved 'detail' for a bad FilterSpec."""
    uid = await _user(db_session, 'if@cse.test', 'if_cse')
    bid = await _branch(db_session, uid, 'CSEIF')

    bad_spec = {
        'type': 'group', 'op': 'AND', 'negate': False,
        'children': [
            {'type': 'cond', 'field': 'nonsense', 'op': 'eq', 'value': 1, 'negate': False}
        ],
    }

    res = await ctrl.create(
        SavedViewCreate(name='bad', scope_branch_id=bid, filter_spec=bad_spec),
        _req(uid),
        db_session,
    )
    _assert_error(res, "INVALID_FILTER", "validation")
    assert res.get("detail"), "INVALID_FILTER must preserve the 'detail' extra field"


# --- FORBIDDEN: NOT_VIEW_VISIBLE (private branch view, non-owner member) -----

async def test_error_not_view_visible_on_get_detail(db_session):
    """get_detail() returns forbidden envelope when a member who is NOT the owner
    opens another member's PRIVATE branch view (_accessible: member, not owner,
    visibility != 'shared')."""
    owner  = await _user(db_session, 'vown@cse.test', 'vown_cse')
    member = await _user(db_session, 'vmem@cse.test', 'vmem_cse')
    bid    = await _branch(db_session, owner, 'CSENVV', member=member)

    vid = (await ctrl.create(
        SavedViewCreate(name='priv', scope_branch_id=bid, filter_spec=_SPEC, visibility='private'),
        _req(owner),
        db_session,
    ))['view_id']

    res = await ctrl.get_detail(vid, _req(member), db_session)
    _assert_error(res, "NOT_VIEW_VISIBLE", "forbidden")


# --- VALIDATION: VIEW_SCOPE_MISMATCH (personal view cannot be shared) --------

async def test_error_view_scope_mismatch_on_create(db_session):
    """create() rejects a personal (scope_branch_id=None) view declared 'shared'."""
    uid = await _user(db_session, 'vsm@cse.test', 'vsm_cse')

    res = await ctrl.create(
        SavedViewCreate(name='personal', scope_branch_id=None, filter_spec=_SPEC, visibility='shared'),
        _req(uid),
        db_session,
    )
    _assert_error(res, "VIEW_SCOPE_MISMATCH", "validation")
