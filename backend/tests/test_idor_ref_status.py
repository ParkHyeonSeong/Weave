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
from core.model import canvas_page as canvas_page_model
from core.model import chat_message as chat_message_model
from core.model import task_page_link as task_page_link_model
from core.model import schedule_event_task as schedule_event_task_model


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


async def _archive_branch(db, branch_id):
    await db.execute(text("UPDATE branch SET is_archived = TRUE WHERE branch_id = :b"),
                     {"b": branch_id})


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


async def _archive_canvas(db, canvas_id):
    await db.execute(text("UPDATE canvas SET is_archived = TRUE WHERE canvas_id = :c"),
                     {"c": canvas_id})


async def _assign(db, task_id, user_id, role="main"):
    await db.execute(text("""
        INSERT INTO task_assignee (task_id, user_id, role)
        VALUES (:t, :u, :r)
    """), {"t": task_id, "u": user_id, "r": role})


async def _make_room(db, created_by):
    row = await db.execute(text("""
        INSERT INTO chat_room (room_type, created_by) VALUES ('dm', :u) RETURNING room_id
    """), {"u": created_by})
    return row.scalar_one()


async def _link_task_page(db, task_id, page_id):
    await db.execute(text("""
        INSERT INTO task_page_link (task_id, page_id) VALUES (:t, :p)
    """), {"t": task_id, "p": page_id})


# ---------------------------------------------------------------------------
# archived-container filtering — ref hydration must not surface entities whose
# parent branch/canvas was archived (soft-deleted). Archive keeps the *_member
# row, so membership alone does not exclude them; the model SQL must filter
# is_archived. Each test locks both directions (archived absent, active present).
# ---------------------------------------------------------------------------

async def test_task_batch_excludes_archived_branch(db_session):
    """아카이브된 branch의 task는 멤버라도 batch_statuses에서 제외된다."""
    alice = await _make_user(db_session, "alice_ar@refstatus.test", "alice_ar")
    b_live = await _make_branch(db_session, alice, name="Live", key="ARTL")
    await _add_member(db_session, b_live, alice, "member")
    t_live = await _make_task(db_session, b_live, alice, title="Live", status="todo")

    b_arch = await _make_branch(db_session, alice, name="Arch", key="ARTA")
    await _add_member(db_session, b_arch, alice, "member")
    t_arch = await _make_task(db_session, b_arch, alice, title="Archived", status="todo")
    await _archive_branch(db_session, b_arch)

    out = await task_model.batch_statuses([t_live, t_arch], alice, db_session)
    assert str(t_arch) not in out
    assert str(t_live) in out


async def test_issue_batch_excludes_archived_branch(db_session):
    """아카이브된 branch task의 issue는 batch_statuses에서 제외된다."""
    alice = await _make_user(db_session, "alice_ari@refstatus.test", "alice_ari")
    b_live = await _make_branch(db_session, alice, name="Live", key="ARIL")
    await _add_member(db_session, b_live, alice, "member")
    t_live = await _make_task(db_session, b_live, alice, title="Live")
    i_live = await _make_issue(db_session, t_live, alice, title="Live issue")

    b_arch = await _make_branch(db_session, alice, name="Arch", key="ARIA")
    await _add_member(db_session, b_arch, alice, "member")
    t_arch = await _make_task(db_session, b_arch, alice, title="Arch")
    i_arch = await _make_issue(db_session, t_arch, alice, title="Arch issue")
    await _archive_branch(db_session, b_arch)

    out = await issue_model.batch_statuses([i_live, i_arch], alice, db_session)
    assert str(i_arch) not in out
    assert str(i_live) in out


async def test_doc_batch_excludes_archived_canvas(db_session):
    """아카이브된 canvas의 page는 batch_titles에서 제외된다."""
    alice = await _make_user(db_session, "alice_ard@refstatus.test", "alice_ard")
    c_live = await _make_canvas(db_session, alice, name="Live", key="ARDL")
    await _add_canvas_member(db_session, c_live, alice, "member")
    p_live = await _make_page(db_session, c_live, alice, title="Live page")

    c_arch = await _make_canvas(db_session, alice, name="Arch", key="ARDA")
    await _add_canvas_member(db_session, c_arch, alice, "member")
    p_arch = await _make_page(db_session, c_arch, alice, title="Arch page")
    await _archive_canvas(db_session, c_arch)

    out = await canvas_page_model.batch_titles([p_live, p_arch], alice, db_session)
    assert str(p_arch) not in out
    assert str(p_live) in out


async def test_task_search_excludes_archived_branch(db_session):
    """search_for_chat(/ta)는 아카이브된 branch의 task를 반환하지 않는다."""
    alice = await _make_user(db_session, "alice_ars@refstatus.test", "alice_ars")
    b_live = await _make_branch(db_session, alice, name="Live", key="ARSL")
    await _add_member(db_session, b_live, alice, "member")
    t_live = await _make_task(db_session, b_live, alice, title="ZxqLive")

    b_arch = await _make_branch(db_session, alice, name="Arch", key="ARSA")
    await _add_member(db_session, b_arch, alice, "member")
    t_arch = await _make_task(db_session, b_arch, alice, title="ZxqArch")
    await _archive_branch(db_session, b_arch)

    rows = await task_model.search_for_chat(alice, "Zxq", False, db_session)
    ids = {r["task_id"] for r in rows}
    assert t_arch not in ids
    assert t_live in ids


async def test_issue_search_excludes_archived_branch(db_session):
    """issue search_for_chat은 아카이브된 branch의 issue를 반환하지 않는다."""
    alice = await _make_user(db_session, "alice_aris@refstatus.test", "alice_aris")
    b_live = await _make_branch(db_session, alice, name="Live", key="ARISL")
    await _add_member(db_session, b_live, alice, "member")
    t_live = await _make_task(db_session, b_live, alice, title="t")
    i_live = await _make_issue(db_session, t_live, alice, title="WqxLive")

    b_arch = await _make_branch(db_session, alice, name="Arch", key="ARISA")
    await _add_member(db_session, b_arch, alice, "member")
    t_arch = await _make_task(db_session, b_arch, alice, title="t")
    i_arch = await _make_issue(db_session, t_arch, alice, title="WqxArch")
    await _archive_branch(db_session, b_arch)

    rows = await issue_model.search_for_chat(alice, "Wqx", db_session)
    ids = {r["issue_id"] for r in rows}
    assert i_arch not in ids
    assert i_live in ids


async def test_doc_search_excludes_archived_canvas(db_session):
    """canvas_page search_for_chat은 아카이브된 canvas의 page를 반환하지 않는다."""
    alice = await _make_user(db_session, "alice_ards@refstatus.test", "alice_ards")
    c_live = await _make_canvas(db_session, alice, name="Live", key="ARDSL")
    await _add_canvas_member(db_session, c_live, alice, "member")
    p_live = await _make_page(db_session, c_live, alice, title="VkpLive")

    c_arch = await _make_canvas(db_session, alice, name="Arch", key="ARDSA")
    await _add_canvas_member(db_session, c_arch, alice, "member")
    p_arch = await _make_page(db_session, c_arch, alice, title="VkpArch")
    await _archive_canvas(db_session, c_arch)

    rows = await canvas_page_model.search_for_chat(alice, "Vkp", db_session)
    ids = {r["page_id"] for r in rows}
    assert p_arch not in ids
    assert p_live in ids


async def test_my_tasks_excludes_archived_branch(db_session):
    """find_by_assignee(My Tasks)는 아카이브된 branch의 담당 task를 빼고 반환한다."""
    alice = await _make_user(db_session, "alice_mt@refstatus.test", "alice_mt")
    b_live = await _make_branch(db_session, alice, name="Live", key="ARMTL")
    await _add_member(db_session, b_live, alice, "member")
    t_live = await _make_task(db_session, b_live, alice, title="Live")
    await _assign(db_session, t_live, alice)

    b_arch = await _make_branch(db_session, alice, name="Arch", key="ARMTA")
    await _add_member(db_session, b_arch, alice, "member")
    t_arch = await _make_task(db_session, b_arch, alice, title="Arch")
    await _assign(db_session, t_arch, alice)
    await _archive_branch(db_session, b_arch)

    rows = await task_model.find_by_assignee(alice, None, None, None, None, "updated", db_session)
    ids = {r["task_id"] for r in rows}
    assert t_arch not in ids
    assert t_live in ids


async def test_chat_history_nulls_archived_branch_ref(db_session):
    """find_by_room: 아카이브된 branch의 task_ref는 카드만 None 처리하고 메시지 행은 유지한다."""
    alice = await _make_user(db_session, "alice_ch@refstatus.test", "alice_ch")
    b_live = await _make_branch(db_session, alice, name="Live", key="ARCHL")
    await _add_member(db_session, b_live, alice, "member")
    t_live = await _make_task(db_session, b_live, alice, title="Live")

    b_arch = await _make_branch(db_session, alice, name="Arch", key="ARCHA")
    await _add_member(db_session, b_arch, alice, "member")
    t_arch = await _make_task(db_session, b_arch, alice, title="Arch")
    await _archive_branch(db_session, b_arch)

    room = await _make_room(db_session, alice)
    m_live = await chat_message_model.create(room, alice, "live", db_session, task_id=t_live)
    m_arch = await chat_message_model.create(room, alice, "arch", db_session, task_id=t_arch)

    msgs = await chat_message_model.find_by_room(room, 50, 0, db_session)
    by_id = {m["message_id"]: m for m in msgs}

    # 메시지 행은 둘 다 남아있어야 한다 (drop 금지)
    assert m_live["message_id"] in by_id
    assert m_arch["message_id"] in by_id
    # 아카이브 branch의 ref 카드만 None
    assert by_id[m_arch["message_id"]]["task_ref"] is None
    assert by_id[m_live["message_id"]]["task_ref"] is not None
    assert by_id[m_live["message_id"]]["task_ref"]["task_id"] == t_live


async def test_task_page_link_excludes_archived_canvas(db_session):
    """태스크 상세 Linked Docs는 아카이브된 canvas의 page를 빼고 반환한다."""
    alice = await _make_user(db_session, "alice_tpl@refstatus.test", "alice_tpl")
    b = await _make_branch(db_session, alice, name="B", key="ARTPL")
    await _add_member(db_session, b, alice, "member")
    task = await _make_task(db_session, b, alice, title="t")

    c_live = await _make_canvas(db_session, alice, name="Live", key="TPLL")
    p_live = await _make_page(db_session, c_live, alice, title="Live page")
    await _link_task_page(db_session, task, p_live)

    c_arch = await _make_canvas(db_session, alice, name="Arch", key="TPLA")
    p_arch = await _make_page(db_session, c_arch, alice, title="Arch page")
    await _link_task_page(db_session, task, p_arch)
    await _archive_canvas(db_session, c_arch)

    rows = await task_page_link_model.find_by_task(task, db_session)
    ids = {r["page_id"] for r in rows}
    assert p_arch not in ids
    assert p_live in ids


async def test_schedule_search_excludes_archived_branch(db_session):
    """일정 이벤트 태스크 연결 검색은 아카이브된 branch의 task를 반환하지 않는다."""
    alice = await _make_user(db_session, "alice_sk@refstatus.test", "alice_sk")
    b_live = await _make_branch(db_session, alice, name="Live", key="ARSKL")
    await _add_member(db_session, b_live, alice, "member")
    t_live = await _make_task(db_session, b_live, alice, title="SkedXyz")

    b_arch = await _make_branch(db_session, alice, name="Arch", key="ARSKA")
    await _add_member(db_session, b_arch, alice, "member")
    t_arch = await _make_task(db_session, b_arch, alice, title="SkedXyz")
    await _archive_branch(db_session, b_arch)

    live_ids = {r["task_id"] for r in
                await schedule_event_task_model.search_tasks(b_live, "SkedXyz", 0, db_session)}
    arch_ids = {r["task_id"] for r in
                await schedule_event_task_model.search_tasks(b_arch, "SkedXyz", 0, db_session)}
    assert t_live in live_ids
    assert t_arch not in arch_ids


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
