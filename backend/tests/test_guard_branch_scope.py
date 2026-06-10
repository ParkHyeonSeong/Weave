"""Unit tests for the cross-branch IDOR guard helper.

Style: direct model/controller-level calls (no HTTP client), seeding with raw
INSERTs via the rollback-isolated ``db_session`` fixture. See
test_track_home.py / test_controller_scrum_board.py for the shared pattern.
"""
import pytest
from sqlalchemy import text

from core.guard.branch_scope import find_resource_in_branch


# ---------------------------------------------------------------------------
# seed helpers (raw INSERT — real schema column names)
# ---------------------------------------------------------------------------

async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Test Branch", key="TEST"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    return row.scalar_one()


async def _make_workflow_status(db, branch_id, key="custom", label="Custom"):
    row = await db.execute(text("""
        INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order)
        VALUES (:b, :k, :l, '#FF5733', 'other', 99)
        RETURNING workflow_status_id
    """), {"b": branch_id, "k": key, "l": label})
    return row.scalar_one()


async def _make_task_type(db, branch_id, key="custom_type"):
    row = await db.execute(text("""
        INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
        VALUES (:b, :k, 'Custom Type', 'Icon', '#5E6AD2', 99)
        RETURNING type_id
    """), {"b": branch_id, "k": key})
    return row.scalar_one()


async def _make_sprint(db, branch_id, created_by, name="Sprint 1"):
    row = await db.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, goal, created_by, status)
        VALUES (:b, :n, 'goal', :u, 'active') RETURNING sprint_id
    """), {"b": branch_id, "n": name, "u": created_by})
    return row.scalar_one()


async def _make_task(db, branch_id, created_by):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, 'Test Task', 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "u": created_by})
    return res.scalar_one()


async def _make_epic(db, branch_id, created_by):
    row = await db.execute(text("""
        INSERT INTO epic (branch_id, epic_name, created_by)
        VALUES (:b, 'Test Epic', :u) RETURNING epic_id
    """), {"b": branch_id, "u": created_by})
    return row.scalar_one()


async def _make_canvas(db, branch_id, created_by, key="cv1"):
    row = await db.execute(text("""
        INSERT INTO canvas (branch_id, canvas_name, key, visibility, created_by)
        VALUES (:b, 'Test Canvas', :k, 'private', :u) RETURNING canvas_id
    """), {"b": branch_id, "k": key, "u": created_by})
    return row.scalar_one()


async def _make_canvas_page(db, canvas_id, created_by, is_archived=False):
    row = await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, parent_page_id, position,
                                 created_by, updated_by, type, is_archived)
        VALUES (:c, 'Test Page', '', NULL, 0, :u, :u, 'document', :a)
        RETURNING page_id
    """), {"c": canvas_id, "u": created_by, "a": is_archived})
    return row.scalar_one()


# ---------------------------------------------------------------------------
# workflow_status
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_workflow_status_same_branch_returns_row(db_session):
    user = await _make_user(db_session, "ws1@test.com", "ws1")
    branch1 = await _make_branch(db_session, user, name="B1", key="WS1")
    status_id = await _make_workflow_status(db_session, branch1, key="test_status")

    result = await find_resource_in_branch(
        status_id, branch1, 'workflow_status', db_session)
    assert result is not None
    assert result['workflow_status_id'] == status_id
    assert result['branch_id'] == branch1
    assert result['key'] == 'test_status'


@pytest.mark.asyncio
async def test_workflow_status_cross_branch_returns_none(db_session):
    user = await _make_user(db_session, "ws2@test.com", "ws2")
    branch1 = await _make_branch(db_session, user, name="B1", key="WS2A")
    branch2 = await _make_branch(db_session, user, name="B2", key="WS2B")
    status_id = await _make_workflow_status(db_session, branch2)

    result = await find_resource_in_branch(
        status_id, branch1, 'workflow_status', db_session)
    assert result is None


# ---------------------------------------------------------------------------
# task_type
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_task_type_same_branch_returns_row(db_session):
    user = await _make_user(db_session, "tt1@test.com", "tt1")
    branch1 = await _make_branch(db_session, user, name="B1", key="TT1")
    type_id = await _make_task_type(db_session, branch1)

    result = await find_resource_in_branch(
        type_id, branch1, 'task_type', db_session)
    assert result is not None
    assert result['type_id'] == type_id
    assert result['branch_id'] == branch1


@pytest.mark.asyncio
async def test_task_type_cross_branch_returns_none(db_session):
    user = await _make_user(db_session, "tt2@test.com", "tt2")
    branch1 = await _make_branch(db_session, user, name="B1", key="TT2A")
    branch2 = await _make_branch(db_session, user, name="B2", key="TT2B")
    type_id = await _make_task_type(db_session, branch2)

    result = await find_resource_in_branch(
        type_id, branch1, 'task_type', db_session)
    assert result is None


# ---------------------------------------------------------------------------
# sprint
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sprint_same_branch_returns_row(db_session):
    user = await _make_user(db_session, "sp1@test.com", "sp1")
    branch1 = await _make_branch(db_session, user, name="B1", key="SP1")
    sprint_id = await _make_sprint(db_session, branch1, user)

    result = await find_resource_in_branch(
        sprint_id, branch1, 'sprint', db_session)
    assert result is not None
    assert result['sprint_id'] == sprint_id
    assert result['branch_id'] == branch1


@pytest.mark.asyncio
async def test_sprint_cross_branch_returns_none(db_session):
    user = await _make_user(db_session, "sp2@test.com", "sp2")
    branch1 = await _make_branch(db_session, user, name="B1", key="SP2A")
    branch2 = await _make_branch(db_session, user, name="B2", key="SP2B")
    sprint_id = await _make_sprint(db_session, branch2, user)

    result = await find_resource_in_branch(
        sprint_id, branch1, 'sprint', db_session)
    assert result is None


# ---------------------------------------------------------------------------
# task
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_task_same_branch_returns_row(db_session):
    user = await _make_user(db_session, "tk1@test.com", "tk1")
    branch1 = await _make_branch(db_session, user, name="B1", key="TK1")
    task_id = await _make_task(db_session, branch1, user)

    result = await find_resource_in_branch(
        task_id, branch1, 'task', db_session)
    assert result is not None
    assert result['task_id'] == task_id
    assert result['branch_id'] == branch1


@pytest.mark.asyncio
async def test_task_cross_branch_returns_none(db_session):
    user = await _make_user(db_session, "tk2@test.com", "tk2")
    branch1 = await _make_branch(db_session, user, name="B1", key="TK2A")
    branch2 = await _make_branch(db_session, user, name="B2", key="TK2B")
    task_id = await _make_task(db_session, branch2, user)

    result = await find_resource_in_branch(
        task_id, branch1, 'task', db_session)
    assert result is None


# ---------------------------------------------------------------------------
# epic
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_epic_same_branch_returns_row(db_session):
    user = await _make_user(db_session, "ep1@test.com", "ep1")
    branch1 = await _make_branch(db_session, user, name="B1", key="EP1")
    epic_id = await _make_epic(db_session, branch1, user)

    result = await find_resource_in_branch(
        epic_id, branch1, 'epic', db_session)
    assert result is not None
    assert result['epic_id'] == epic_id
    assert result['branch_id'] == branch1


@pytest.mark.asyncio
async def test_epic_cross_branch_returns_none(db_session):
    user = await _make_user(db_session, "ep2@test.com", "ep2")
    branch1 = await _make_branch(db_session, user, name="B1", key="EP2A")
    branch2 = await _make_branch(db_session, user, name="B2", key="EP2B")
    epic_id = await _make_epic(db_session, branch2, user)

    result = await find_resource_in_branch(
        epic_id, branch1, 'epic', db_session)
    assert result is None


# ---------------------------------------------------------------------------
# canvas
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_canvas_same_branch_returns_row(db_session):
    user = await _make_user(db_session, "cv1@test.com", "cv1")
    branch1 = await _make_branch(db_session, user, name="B1", key="CV1")
    canvas_id = await _make_canvas(db_session, branch1, user, key="cvb1")

    result = await find_resource_in_branch(
        canvas_id, branch1, 'canvas', db_session)
    assert result is not None
    assert result['canvas_id'] == canvas_id
    assert result['branch_id'] == branch1


@pytest.mark.asyncio
async def test_canvas_cross_branch_returns_none(db_session):
    user = await _make_user(db_session, "cv2@test.com", "cv2")
    branch1 = await _make_branch(db_session, user, name="B1", key="CV2A")
    branch2 = await _make_branch(db_session, user, name="B2", key="CV2B")
    canvas_id = await _make_canvas(db_session, branch2, user, key="cvb2")

    result = await find_resource_in_branch(
        canvas_id, branch1, 'canvas', db_session)
    assert result is None


# ---------------------------------------------------------------------------
# canvas_page (scoped via canvas.branch_id)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_canvas_page_same_branch_returns_row(db_session):
    user = await _make_user(db_session, "cp1@test.com", "cp1")
    branch1 = await _make_branch(db_session, user, name="B1", key="CP1")
    canvas_id = await _make_canvas(db_session, branch1, user, key="cpb1")
    page_id = await _make_canvas_page(db_session, canvas_id, user)

    result = await find_resource_in_branch(
        page_id, branch1, 'canvas_page', db_session)
    assert result is not None
    assert result['page_id'] == page_id
    assert result['canvas_id'] == canvas_id
    assert result['branch_id'] == branch1


@pytest.mark.asyncio
async def test_canvas_page_cross_branch_returns_none(db_session):
    user = await _make_user(db_session, "cp2@test.com", "cp2")
    branch1 = await _make_branch(db_session, user, name="B1", key="CP2A")
    branch2 = await _make_branch(db_session, user, name="B2", key="CP2B")
    canvas_id = await _make_canvas(db_session, branch2, user, key="cpb2")
    page_id = await _make_canvas_page(db_session, canvas_id, user)

    result = await find_resource_in_branch(
        page_id, branch1, 'canvas_page', db_session)
    assert result is None


@pytest.mark.asyncio
async def test_canvas_page_archived_still_returned(db_session):
    """Guard is a pure branch-scope check: an archived page in the same branch
    is still returned (callers handle archived visibility themselves)."""
    user = await _make_user(db_session, "cp3@test.com", "cp3")
    branch1 = await _make_branch(db_session, user, name="B1", key="CP3")
    canvas_id = await _make_canvas(db_session, branch1, user, key="cpb3")
    page_id = await _make_canvas_page(db_session, canvas_id, user, is_archived=True)

    result = await find_resource_in_branch(
        page_id, branch1, 'canvas_page', db_session)
    assert result is not None
    assert result['page_id'] == page_id
    assert result['is_archived'] is True
    assert result['branch_id'] == branch1


# ---------------------------------------------------------------------------
# branch_id=None: fetch-without-scoping (used by star.py / track.py call sites)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_task_branch_none_returns_row_with_branch_id(db_session):
    """branch_id=None: branch 필터 없이 리소스를 조회해 branch_id를 노출."""
    user = await _make_user(db_session, "bn1@test.com", "bn1")
    branch1 = await _make_branch(db_session, user, name="B1", key="BN1")
    task_id = await _make_task(db_session, branch1, user)

    result = await find_resource_in_branch(
        task_id, None, 'task', db_session)
    assert result is not None
    assert result['task_id'] == task_id
    assert result['branch_id'] == branch1


@pytest.mark.asyncio
async def test_canvas_page_branch_none_returns_row_with_branch_id(db_session):
    user = await _make_user(db_session, "bn2@test.com", "bn2")
    branch1 = await _make_branch(db_session, user, name="B1", key="BN2")
    canvas_id = await _make_canvas(db_session, branch1, user, key="bn2cv")
    page_id = await _make_canvas_page(db_session, canvas_id, user)

    result = await find_resource_in_branch(
        page_id, None, 'canvas_page', db_session)
    assert result is not None
    assert result['page_id'] == page_id
    assert result['branch_id'] == branch1


@pytest.mark.asyncio
async def test_branch_none_missing_resource_returns_none(db_session):
    """branch_id=None이라도 존재하지 않는 리소스는 None."""
    user = await _make_user(db_session, "bn3@test.com", "bn3")
    await _make_branch(db_session, user, name="B1", key="BN3")

    result = await find_resource_in_branch(
        999999, None, 'task', db_session)
    assert result is None


@pytest.mark.asyncio
async def test_branch_none_returns_resource_from_different_branch(db_session):
    """Regression: branch_id=None deliberately bypasses scoping — a resource
    living in a DIFFERENT branch is still returned (intentional unscoping
    contract; the caller is responsible for its own membership check)."""
    user = await _make_user(db_session, "bn4@test.com", "bn4")
    branch1 = await _make_branch(db_session, user, name="B1", key="BN4A")
    branch2 = await _make_branch(db_session, user, name="B2", key="BN4B")
    # task lives in branch2; we fetch unscoped from "the perspective of" branch1.
    task_id = await _make_task(db_session, branch2, user)

    result = await find_resource_in_branch(
        task_id, None, 'task', db_session)
    assert result is not None
    assert result['task_id'] == task_id
    # scoping is bypassed: the returned row belongs to branch2, not branch1.
    assert result['branch_id'] == branch2
    assert result['branch_id'] != branch1


# ---------------------------------------------------------------------------
# edge cases
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_unsupported_resource_type_returns_none(db_session):
    user = await _make_user(db_session, "ed1@test.com", "ed1")
    branch1 = await _make_branch(db_session, user, name="B1", key="ED1")

    result = await find_resource_in_branch(
        999, branch1, 'invalid_type', db_session)
    assert result is None


@pytest.mark.asyncio
async def test_missing_resource_returns_none(db_session):
    user = await _make_user(db_session, "ed2@test.com", "ed2")
    branch1 = await _make_branch(db_session, user, name="B1", key="ED2")

    result = await find_resource_in_branch(
        999999, branch1, 'workflow_status', db_session)
    assert result is None
