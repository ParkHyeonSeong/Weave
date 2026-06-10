"""IDOR / 정보 노출 regression tests for the ref-status batch endpoint (SEC-35).

Style: direct model-level calls (no HTTP client), seeding with raw INSERTs via
the rollback-isolated ``db_session`` fixture. See test_track_home.py /
test_idor_workflow_status.py for the shared pattern.

Endpoint (``POST /api/ref-status``) renders inline ref chips inside canvas
pages. The request body carries only ``task_ids`` / ``issue_ids`` (NO branch_id)
because a single page may legitimately reference tasks/issues across multiple
branches. The router delegates straight to::

    task_model.batch_statuses(task_ids, user_id, db)
    issue_model.batch_statuses(issue_ids, user_id, db)

Gap (SEC-35): a batch read must not leak the status / existence of refs whose
branch the caller cannot access. Because this is a read batch over potentially
cross-branch refs, the correct defense is "return only accessible refs" (scope
to caller-member branches and silently drop the rest) rather than "deny the
whole request". The scoping lives in the model SQL:

  * task.batch_statuses  — INNER JOIN branch_member bm
                              ON bm.branch_id = t.branch_id AND bm.user_id = :uid
  * task_issue.batch_statuses — issue scoped via its parent task's branch:
        INNER JOIN task t ON t.task_id = ti.task_id
        INNER JOIN branch_member bm
              ON bm.branch_id = t.branch_id AND bm.user_id = :uid

These tests lock in that behaviour:
  1. a non-member branch's task/issue id MUST NOT appear in the response,
  2. regression: a member branch's task/issue is returned with full metadata,
  3. a mixed batch returns only the member-accessible subset.
"""
from sqlalchemy import text

from core.model import task as task_model
from core.model import task_issue as issue_model


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
    """Create a branch and seed its default workflow statuses."""
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


async def _make_task(db, branch_id, created_by, title="Task", status="todo"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, :s, :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "s": status, "u": created_by})
    return res.scalar_one()


async def _make_issue(db, task_id, created_by, title="Issue", status="open"):
    res = await db.execute(text("""
        INSERT INTO task_issue (task_id, title, body, status, created_by)
        VALUES (:t, :title, 'body', :s, :u) RETURNING issue_id
    """), {"t": task_id, "title": title, "s": status, "u": created_by})
    return res.scalar_one()


# ---------------------------------------------------------------------------
# task.batch_statuses — cross-branch info leak
# ---------------------------------------------------------------------------

async def test_task_batch_excludes_non_member_branch(db_session):
    """비멤버 branch의 task_id를 배치로 요청해도 그 status가 응답에 노출되지 않는다."""
    alice = await _make_user(db_session, "alice@refstatus.test", "alice_rs")
    bob = await _make_user(db_session, "bob@refstatus.test", "bob_rs")

    # alice가 멤버인 branch
    b1 = await _make_branch(db_session, alice, name="B1", key="RSB1")
    await _add_member(db_session, b1, alice, "member")
    t1 = await _make_task(db_session, b1, alice, title="Mine", status="in_progress")

    # alice가 멤버가 아닌 branch
    b2 = await _make_branch(db_session, bob, name="B2", key="RSB2")
    await _add_member(db_session, b2, bob, "admin")
    t2 = await _make_task(db_session, b2, bob, title="Secret", status="done")

    # alice가 자신의 task와 타 branch task를 섞어 배치 조회
    out = await task_model.batch_statuses([t1, t2], alice, db_session)

    # 비멤버 branch task는 응답에서 제외 (존재/상태 미노출)
    assert str(t2) not in out
    # 멤버 branch task는 정상 반환 (회귀)
    assert str(t1) in out
    assert out[str(t1)]["status"] == "in_progress"
    assert out[str(t1)]["status_label"] == "In Progress"
    assert out[str(t1)]["status_color"] == "#2563EB"
    assert out[str(t1)]["status_category"] == "in_progress"


async def test_task_batch_member_branch_returned(db_session):
    """회귀: 멤버 branch의 task는 status + workflow 메타데이터까지 정상 반환."""
    alice = await _make_user(db_session, "alice2@refstatus.test", "alice2_rs")
    b1 = await _make_branch(db_session, alice, name="B1", key="RSOK")
    await _add_member(db_session, b1, alice, "member")
    t1 = await _make_task(db_session, b1, alice, title="Done", status="done")

    out = await task_model.batch_statuses([t1], alice, db_session)
    assert str(t1) in out
    assert out[str(t1)]["status"] == "done"
    assert out[str(t1)]["status_label"] == "Done"


# ---------------------------------------------------------------------------
# task_issue.batch_statuses — issue scoped via its parent task's branch
# ---------------------------------------------------------------------------

async def test_issue_batch_excludes_non_member_branch(db_session):
    """비멤버 branch task에 달린 issue_id 요청 시 그 status가 노출되지 않는다."""
    alice = await _make_user(db_session, "alice_i@refstatus.test", "alice_i_rs")
    bob = await _make_user(db_session, "bob_i@refstatus.test", "bob_i_rs")

    b1 = await _make_branch(db_session, alice, name="BA", key="RSIA")
    await _add_member(db_session, b1, alice, "member")
    t1 = await _make_task(db_session, b1, alice, title="Mine")
    i1 = await _make_issue(db_session, t1, alice, title="Open one", status="open")

    b2 = await _make_branch(db_session, bob, name="BB", key="RSIB")
    await _add_member(db_session, b2, bob, "admin")
    t2 = await _make_task(db_session, b2, bob, title="Secret")
    i2 = await _make_issue(db_session, t2, bob, title="Secret issue", status="closed")

    out = await issue_model.batch_statuses([i1, i2], alice, db_session)

    # 비멤버 branch task의 issue는 제외
    assert str(i2) not in out
    # 멤버 branch task의 issue는 정상 반환 (회귀)
    assert str(i1) in out
    assert out[str(i1)]["status"] == "open"


async def test_issue_batch_member_branch_returned(db_session):
    """회귀: 멤버 branch task의 issue는 status가 정상 반환."""
    alice = await _make_user(db_session, "alice_i2@refstatus.test", "alice_i2_rs")
    b1 = await _make_branch(db_session, alice, name="BA", key="RSIOK")
    await _add_member(db_session, b1, alice, "member")
    t1 = await _make_task(db_session, b1, alice, title="Mine")
    i1 = await _make_issue(db_session, t1, alice, title="Closed one", status="closed")

    out = await issue_model.batch_statuses([i1], alice, db_session)
    assert str(i1) in out
    assert out[str(i1)]["status"] == "closed"


# ---------------------------------------------------------------------------
# empty input guard
# ---------------------------------------------------------------------------

async def test_empty_inputs_return_empty(db_session):
    alice = await _make_user(db_session, "alice_e@refstatus.test", "alice_e_rs")
    assert await task_model.batch_statuses([], alice, db_session) == {}
    assert await issue_model.batch_statuses([], alice, db_session) == {}
