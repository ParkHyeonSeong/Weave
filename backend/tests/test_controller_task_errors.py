"""Error-contract tests for core.controller.task (SP-2 bulk migration).

Verifies that after replacing bare {'status': False, 'message': CODE} dicts with
error_response(ErrorCode.CODE), the unified envelope fields (code, category,
retryable, and dual-emit message==code) are present for one representative path
per distinct error category found in task.py.

Style: direct controller-function calls (no HTTP client), request/body via
types.SimpleNamespace, seed rows with raw sqlalchemy text() INSERTs cribbed from
test_idor_task_assignee.py (branch/user/member/task helpers) and
test_idor_task_reorder.py (sprint helper).
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task as ctrl
from routers.schema import task as schema


def _req(user_id: int):
    """Minimal request.state.payload stub used by every controller function."""
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id, 'username': 'tester'}))


# ---------------------------------------------------------------------------
# seed helpers — cribbed verbatim from test_idor_task_assignee.py
# ---------------------------------------------------------------------------

async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Branch", key="KEY"):
    """Create a branch and seed its 4 default workflow statuses + default task_type."""
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
    # default task_type so create() passes INVALID_TASK_TYPE check
    await db.execute(text("""
        INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
        VALUES (:b, 'task', 'Task', 'check', '#5E6AD2', 0)
    """), {"b": bid})
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


# sprint helper — cribbed verbatim from test_idor_task_reorder.py
async def _make_sprint(db, branch_id, created_by, name="Sprint 1"):
    row = await db.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, goal, created_by, status)
        VALUES (:b, :n, 'goal', :u, 'active') RETURNING sprint_id
    """), {"b": branch_id, "n": name, "u": created_by})
    return row.scalar_one()


async def _make_task_sequence(db, branch_id):
    await db.execute(text("""
        INSERT INTO task_sequence (branch_id, last_number)
        VALUES (:b, COALESCE((SELECT MAX(display_number) FROM task WHERE branch_id = :b), 0))
        ON CONFLICT (branch_id) DO UPDATE SET last_number = EXCLUDED.last_number
    """), {"b": branch_id})


# ---------------------------------------------------------------------------
# helper: assert the full unified error envelope
# ---------------------------------------------------------------------------

def _assert_error(res, code: str, category: str):
    assert res["status"] is False
    assert res["code"] == code
    assert res["category"] == category
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit invariant


# ---------------------------------------------------------------------------
# FORBIDDEN category — NOT_BRANCH_MEMBER
# A non-member calling get_detail returns the forbidden envelope.
# ---------------------------------------------------------------------------

async def test_get_detail_not_branch_member_returns_forbidden_envelope(db_session):
    alice = await _make_user(db_session, "alice_fe@cte.test", "alice_fe")
    outsider = await _make_user(db_session, "out_fe@cte.test", "out_fe")

    branch = await _make_branch(db_session, alice, name="B-FE", key="CTEFE")
    await _add_member(db_session, branch, alice, "admin")
    task = await _make_task(db_session, branch, alice, "T-FE")

    res = await ctrl.get_detail(task, branch, _req(outsider), db_session)
    _assert_error(res, "NOT_BRANCH_MEMBER", "forbidden")


# ---------------------------------------------------------------------------
# NOT_FOUND category — TASK_NOT_FOUND
# A member requesting a non-existent task_id returns the not_found envelope.
# ---------------------------------------------------------------------------

async def test_get_detail_task_not_found_returns_not_found_envelope(db_session):
    alice = await _make_user(db_session, "alice_nf@cte.test", "alice_nf")

    branch = await _make_branch(db_session, alice, name="B-NF", key="CTENF")
    await _add_member(db_session, branch, alice, "admin")

    res = await ctrl.get_detail(99999999, branch, _req(alice), db_session)
    _assert_error(res, "TASK_NOT_FOUND", "not_found")


# ---------------------------------------------------------------------------
# VALIDATION category — INVALID_DATE_RANGE
# create() rejects start_date > due_date with the validation envelope.
# ---------------------------------------------------------------------------

async def test_create_invalid_date_range_returns_validation_envelope(db_session):
    from datetime import date

    alice = await _make_user(db_session, "alice_dr@cte.test", "alice_dr")

    branch = await _make_branch(db_session, alice, name="B-DR", key="CTEDR")
    await _add_member(db_session, branch, alice, "admin")
    await _make_task_sequence(db_session, branch)

    body = schema.TaskCreate(
        title="bad-dates",
        task_type="task",
        status="todo",
        start_date=date(2026, 6, 25),
        due_date=date(2026, 6, 18),
    )
    res = await ctrl.create(body, branch, _req(alice), db_session)
    _assert_error(res, "INVALID_DATE_RANGE", "validation")


# ---------------------------------------------------------------------------
# BUSINESS category — PARENT_NOT_TOP_LEVEL
# update() rejects setting parent_task_id to a task that is itself a subtask.
# ---------------------------------------------------------------------------

async def test_update_parent_not_top_level_returns_business_envelope(db_session):
    alice = await _make_user(db_session, "alice_pt@cte.test", "alice_pt")

    branch = await _make_branch(db_session, alice, name="B-PT", key="CTEPT")
    await _add_member(db_session, branch, alice, "admin")

    # grandparent (top-level), parent (subtask of grandparent), child (will try to sub-under parent)
    grandparent = await _make_task(db_session, branch, alice, "Grandparent")
    # seed parent as a subtask of grandparent directly via SQL so we bypass the controller
    row = await db_session.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch})
    dn = row.scalar_one()
    res = await db_session.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by, parent_task_id)
        VALUES (:b, :dn, 'Parent(sub)', 'todo', :u, :p) RETURNING task_id
    """), {"b": branch, "dn": dn, "u": alice, "p": grandparent})
    parent_sub = res.scalar_one()

    child = await _make_task(db_session, branch, alice, "Child")

    # child tries to set parent_task_id = parent_sub (which is itself a subtask)
    body = schema.TaskUpdate(parent_task_id=parent_sub)
    # inject model_fields_set so the controller sees the explicit set
    body.model_fields_set.add("parent_task_id")
    res = await ctrl.update(child, body, branch, _req(alice), db_session)
    _assert_error(res, "PARENT_NOT_TOP_LEVEL", "business")


# ---------------------------------------------------------------------------
# Query API (FilterSpec) — added after the SP-1 snapshot. These paths must also
# emit the unified envelope, and INVALID_FILTER must PRESERVE its `detail`
# (str(e) from the filter validator). Mirrors backend/tests/test_task_query_api.py.
# ---------------------------------------------------------------------------

_BAD_FILTER = {"type": "group", "op": "AND", "negate": False,
               "children": [{"type": "cond", "field": "evil", "op": "eq", "value": 1, "negate": False}]}


def _q_body(filter=None, scope=None):
    ns = SimpleNamespace(filter=filter, sort=[], group_by=None, page=1, page_size=50)
    if scope is not None:
        ns.scope = scope
    return ns


async def test_query_branch_non_member_returns_forbidden_envelope(db_session):
    owner = await _make_user(db_session, "q_own@cte.test", "q_own")
    intruder = await _make_user(db_session, "q_bad@cte.test", "q_bad")
    branch = await _make_branch(db_session, owner, name="B-Q1", key="CTEQ1")
    await _add_member(db_session, branch, owner, "admin")  # intruder is NOT a member
    res = await ctrl.query_branch(branch, _q_body(filter=None), _req(intruder), db_session)
    _assert_error(res, "NOT_BRANCH_MEMBER", "forbidden")


async def test_query_branch_invalid_filter_preserves_detail(db_session):
    alice = await _make_user(db_session, "q_if@cte.test", "q_if")
    branch = await _make_branch(db_session, alice, name="B-Q2", key="CTEQ2")
    await _add_member(db_session, branch, alice, "admin")
    res = await ctrl.query_branch(branch, _q_body(filter=_BAD_FILTER), _req(alice), db_session)
    _assert_error(res, "INVALID_FILTER", "validation")
    assert res.get("detail")  # extra field preserved (non-empty str(e))


async def test_query_cross_branch_invalid_scope_returns_validation_envelope(db_session):
    alice = await _make_user(db_session, "q_sc@cte.test", "q_sc")
    res = await ctrl.query_cross_branch(_q_body(filter=None, scope="bogus"), _req(alice), db_session)
    _assert_error(res, "INVALID_SCOPE", "validation")


async def test_query_cross_branch_invalid_filter_preserves_detail(db_session):
    alice = await _make_user(db_session, "q_cif@cte.test", "q_cif")
    res = await ctrl.query_cross_branch(_q_body(filter=_BAD_FILTER, scope="my"), _req(alice), db_session)
    _assert_error(res, "INVALID_FILTER", "validation")
    assert res.get("detail")


# ---------------------------------------------------------------------------
# saved_view_id resolution in the query path (_resolve_view, landed with
# SavedViews). The task query resolves a saved_view_id and can fail with the
# saved-view envelopes — assert the unified shape on those paths too.
# Mirrors backend/tests/test_saved_view_query.py.
# ---------------------------------------------------------------------------
from core.controller import saved_view as _sv_ctrl
from routers.schema.saved_view import SavedViewCreate as _SVCreate


def _q_view(saved_view_id, scope=None):
    ns = SimpleNamespace(filter=None, sort=[], group_by=None, page=1, page_size=50,
                         saved_view_id=saved_view_id)
    if scope is not None:
        ns.scope = scope
    return ns


async def test_query_branch_view_not_found_envelope(db_session):
    alice = await _make_user(db_session, "v_nf@cte.test", "v_nf")
    branch = await _make_branch(db_session, alice, name="B-VNF", key="CTEVNF")
    await _add_member(db_session, branch, alice, "admin")
    res = await ctrl.query_branch(branch, _q_view(999999999), _req(alice), db_session)
    _assert_error(res, "VIEW_NOT_FOUND", "not_found")


async def test_query_branch_personal_view_scope_mismatch_envelope(db_session):
    alice = await _make_user(db_session, "v_sm@cte.test", "v_sm")
    branch = await _make_branch(db_session, alice, name="B-VSM", key="CTEVSM")
    await _add_member(db_session, branch, alice, "admin")
    vid = (await _sv_ctrl.create(
        _SVCreate(name='p', scope_branch_id=None, filter_spec={}),
        _req(alice), db_session))['view_id']
    res = await ctrl.query_branch(branch, _q_view(vid), _req(alice), db_session)
    _assert_error(res, "VIEW_SCOPE_MISMATCH", "validation")


async def test_query_branch_others_private_view_not_visible_envelope(db_session):
    owner = await _make_user(db_session, "v_o@cte.test", "v_o")
    other = await _make_user(db_session, "v_x@cte.test", "v_x")
    branch = await _make_branch(db_session, owner, name="B-VNV", key="CTEVNV")
    await _add_member(db_session, branch, owner, "admin")
    await _add_member(db_session, branch, other, "member")
    vid = (await _sv_ctrl.create(
        _SVCreate(name='priv', scope_branch_id=branch, filter_spec={}, visibility='private'),
        _req(owner), db_session))['view_id']
    res = await ctrl.query_branch(branch, _q_view(vid), _req(other), db_session)
    _assert_error(res, "NOT_VIEW_VISIBLE", "forbidden")
