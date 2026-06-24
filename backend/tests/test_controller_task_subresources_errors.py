"""Error-contract tests for the task-subresources cluster (SP-2 migration).

Covers task_comment, task_issue, and task_page_link controllers.
After migration every failure return uses error_response(ErrorCode.X), so the
response carries code/category/retryable in addition to the legacy message field
(dual-emit: message == code).

Style: direct controller-function calls, request/body via types.SimpleNamespace,
seed rows with raw sqlalchemy text() INSERTs cribbed from test_idor_task_dependency.py
and test_idor_ref_status.py. Rollback-isolated db_session fixture (no commit).
pytest is asyncio auto-mode (no marker needed).
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task_comment as comment_ctrl
from core.controller import task_issue as issue_ctrl
from core.controller import task_page_link as page_link_ctrl


# ---------------------------------------------------------------------------
# Request stub helpers
# ---------------------------------------------------------------------------

def _req(user_id: int, username: str = "u"):
    """Minimal request stub: controller reads request.state.payload."""
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id, "username": username}))


# ---------------------------------------------------------------------------
# Seed helpers (raw INSERT — real schema column names)
# Cribbed verbatim from test_idor_task_dependency.py and test_idor_ref_status.py
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


async def _make_issue(db, task_id, created_by, title="Issue", status="open"):
    res = await db.execute(text("""
        INSERT INTO task_issue (task_id, title, body, status, created_by)
        VALUES (:t, :title, 'body', :s, :u) RETURNING issue_id
    """), {"t": task_id, "title": title, "s": status, "u": created_by})
    return res.scalar_one()


async def _make_canvas(db, created_by, name="Canvas", key="CKEY"):
    row = await db.execute(text("""
        INSERT INTO canvas (canvas_name, key, visibility, created_by)
        VALUES (:n, :k, 'private', :u) RETURNING canvas_id
    """), {"n": name, "k": key, "u": created_by})
    return row.scalar_one()


async def _add_canvas_member(db, canvas_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO canvas_member (canvas_id, user_id, role)
        VALUES (:c, :u, :r)
    """), {"c": canvas_id, "u": user_id, "r": role})


async def _make_page(db, canvas_id, created_by, title="Page"):
    row = await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, created_by)
        VALUES (:c, :t, :body, :u) RETURNING page_id
    """), {"c": canvas_id, "t": title, "body": title, "u": created_by})
    return row.scalar_one()


# ---------------------------------------------------------------------------
# FORBIDDEN category — non-member gets NOT_BRANCH_MEMBER
# Representative controller: task_comment.list_comments
# ---------------------------------------------------------------------------

async def test_non_member_gets_forbidden_category(db_session):
    """브랜치 비멤버가 task_comment 조회 시 NOT_BRANCH_MEMBER (forbidden) 반환."""
    alice = await _make_user(db_session, "tsr_alice@test.test", "tsr_alice")
    stranger = await _make_user(db_session, "tsr_stranger@test.test", "tsr_stranger")
    branch = await _make_branch(db_session, alice, name="TSR1", key="TSR1")
    await _add_member(db_session, branch, alice)
    task = await _make_task(db_session, branch, alice)

    # stranger is NOT a member
    res = await comment_ctrl.list_comments(branch, task, _req(stranger), db_session)
    assert res["status"] is False
    assert res["code"] == "NOT_BRANCH_MEMBER"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]   # dual-emit


# ---------------------------------------------------------------------------
# NOT_FOUND category — non-existent issue → ISSUE_NOT_FOUND
# Representative controller: task_issue.get_issue
# ---------------------------------------------------------------------------

async def test_issue_not_found_gets_not_found_category(db_session):
    """존재하지 않는 issue_id → ISSUE_NOT_FOUND (not_found) 반환."""
    alice = await _make_user(db_session, "tsr_alice2@test.test", "tsr_alice2")
    branch = await _make_branch(db_session, alice, name="TSR2", key="TSR2")
    await _add_member(db_session, branch, alice)
    task = await _make_task(db_session, branch, alice)

    res = await issue_ctrl.get_issue(branch, task, 999999, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "ISSUE_NOT_FOUND"
    assert res["category"] == "not_found"
    assert res["retryable"] is False
    assert res["message"] == res["code"]   # dual-emit


# ---------------------------------------------------------------------------
# FORBIDDEN category (author check) — non-author edit → NOT_ISSUE_AUTHOR
# Representative controller: task_issue.delete_issue
# ---------------------------------------------------------------------------

async def test_non_author_delete_issue_gets_forbidden_category(db_session):
    """이슈 작성자가 아닌 멤버가 삭제 시도 → NOT_ISSUE_AUTHOR (forbidden) 반환."""
    alice = await _make_user(db_session, "tsr_alice3@test.test", "tsr_alice3")
    bob = await _make_user(db_session, "tsr_bob3@test.test", "tsr_bob3")
    branch = await _make_branch(db_session, alice, name="TSR3", key="TSR3")
    await _add_member(db_session, branch, alice)
    await _add_member(db_session, branch, bob)
    task = await _make_task(db_session, branch, alice)
    issue = await _make_issue(db_session, task, alice)

    # bob is a member but NOT the issue author
    res = await issue_ctrl.delete_issue(branch, task, issue, _req(bob), db_session)
    assert res["status"] is False
    assert res["code"] == "NOT_ISSUE_AUTHOR"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]   # dual-emit


# ---------------------------------------------------------------------------
# CONFLICT category — duplicate page link → DUPLICATE_LINK
# Representative controller: task_page_link.link_page
# ---------------------------------------------------------------------------

async def test_duplicate_link_gets_conflict_category(db_session):
    """같은 페이지를 두 번 연결하면 DUPLICATE_LINK (conflict) 반환."""
    alice = await _make_user(db_session, "tsr_alice4@test.test", "tsr_alice4")
    branch = await _make_branch(db_session, alice, name="TSR4", key="TSR4")
    await _add_member(db_session, branch, alice)
    task = await _make_task(db_session, branch, alice)
    canvas = await _make_canvas(db_session, alice, name="TSRCanvas", key="TSRC4")
    await _add_canvas_member(db_session, canvas, alice)
    page = await _make_page(db_session, canvas, alice)

    body = SimpleNamespace(page_id=page)

    # First link should succeed
    res1 = await page_link_ctrl.link_page(body, branch, task, _req(alice), db_session)
    assert res1["status"] is True

    # Second link on same page → DUPLICATE_LINK
    res2 = await page_link_ctrl.link_page(body, branch, task, _req(alice), db_session)
    assert res2["status"] is False
    assert res2["code"] == "DUPLICATE_LINK"
    assert res2["category"] == "conflict"
    assert res2["retryable"] is False
    assert res2["message"] == res2["code"]   # dual-emit
