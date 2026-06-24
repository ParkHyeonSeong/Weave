"""misc 클러스터 error_response 마이그레이션 검증 — dual-emit 확인.

대상 컨트롤러: star.py, activity_log.py (chat.py의 3개 검색 함수는 실패 반환 없음).

각 테스트는 error_response(ErrorCode.X)가 반환하는 딕셔너리에
  - res["status"] is False
  - res["code"] == "<CODE>"
  - res["category"] == "<category>"
  - res["message"] == res["code"]   ← dual-emit (레거시 message 키 유지)
가 모두 참임을 검증한다.

시드 헬퍼는 test_idor_star.py 와 test_activity_log_scoping.py에서 그대로 인용.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import star as star_ctrl
from core.controller import activity_log as al_ctrl
from routers.star import StarToggle


# ---------------------------------------------------------------------------
# request stub
# ---------------------------------------------------------------------------

def _req(user_id: int):
    """controller가 읽는 request.state.payload만 흉내낸다."""
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


# ---------------------------------------------------------------------------
# seed helpers — verbatim from test_idor_star.py
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


async def _add_branch_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by, title="task"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "u": created_by})
    return res.scalar_one()


async def _make_canvas(db, branch_id, created_by, key="cv"):
    row = await db.execute(text("""
        INSERT INTO canvas (branch_id, canvas_name, key, visibility, created_by)
        VALUES (:b, 'Canvas', :k, 'private', :u) RETURNING canvas_id
    """), {"b": branch_id, "k": key, "u": created_by})
    return row.scalar_one()


async def _add_canvas_member(db, canvas_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO canvas_member (canvas_id, user_id, role)
        VALUES (:c, :u, :r)
    """), {"c": canvas_id, "u": user_id, "r": role})


async def _make_canvas_page(db, canvas_id, created_by, title="page"):
    res = await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, position,
                                 created_by, updated_by, type)
        VALUES (:c, :t, '', 0, :u, :u, 'document') RETURNING page_id
    """), {"c": canvas_id, "t": title, "u": created_by})
    return res.scalar_one()


# ---------------------------------------------------------------------------
# FORBIDDEN category: NOT_BRANCH_MEMBER (star.py + activity_log.py)
# ---------------------------------------------------------------------------

async def test_star_toggle_not_branch_member_dual_emit(db_session):
    """비멤버가 다른 branch task를 star 시도 → NOT_BRANCH_MEMBER (forbidden, dual-emit)."""
    alice = await _make_user(db_session, "alice@misc_ec.test", "alice_misc")
    bob = await _make_user(db_session, "bob@misc_ec.test", "bob_misc")

    b1 = await _make_branch(db_session, alice, name="MB1", key="MCB1")
    await _add_branch_member(db_session, b1, alice)

    b2 = await _make_branch(db_session, bob, name="MB2", key="MCB2")
    await _add_branch_member(db_session, b2, bob)
    task = await _make_task(db_session, b2, bob, "Secret")

    res = await star_ctrl.toggle(
        StarToggle(item_type="task", item_id=task), _req(alice), db_session)

    assert res["status"] is False
    assert res["code"] == "NOT_BRANCH_MEMBER"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


async def test_activity_log_branch_not_member_dual_emit(db_session):
    """branch 비멤버가 branch 활동 피드 조회 → NOT_BRANCH_MEMBER (forbidden, dual-emit)."""
    alice = await _make_user(db_session, "alice2@misc_ec.test", "alice2_misc")
    bob = await _make_user(db_session, "bob2@misc_ec.test", "bob2_misc")

    b = await _make_branch(db_session, bob, name="MB3", key="MCB3")
    await _add_branch_member(db_session, b, bob)
    # alice는 멤버가 아님

    res = await al_ctrl.get_branch_activity(b, 20, 0, _req(alice), db_session)

    assert res["status"] is False
    assert res["code"] == "NOT_BRANCH_MEMBER"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# NOT_FOUND category: TASK_NOT_FOUND (star.py)
# ---------------------------------------------------------------------------

async def test_star_toggle_task_not_found_dual_emit(db_session):
    """존재하지 않는 task id를 star 시도 → TASK_NOT_FOUND (not_found, dual-emit)."""
    alice = await _make_user(db_session, "ghost@misc_ec.test", "ghost_misc")

    res = await star_ctrl.toggle(
        StarToggle(item_type="task", item_id=999999), _req(alice), db_session)

    assert res["status"] is False
    assert res["code"] == "TASK_NOT_FOUND"
    assert res["category"] == "not_found"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# VALIDATION category: INVALID_ITEM_TYPE (star.py)
# ---------------------------------------------------------------------------

async def test_star_toggle_invalid_item_type_dual_emit(db_session):
    """알 수 없는 item_type으로 star 시도 → INVALID_ITEM_TYPE (validation, dual-emit)."""
    alice = await _make_user(db_session, "iv@misc_ec.test", "iv_misc")

    res = await star_ctrl.toggle(
        StarToggle(item_type="unknown_type", item_id=1), _req(alice), db_session)

    assert res["status"] is False
    assert res["code"] == "INVALID_ITEM_TYPE"
    assert res["category"] == "validation"
    assert res["retryable"] is False
    assert res["message"] == res["code"]


# ---------------------------------------------------------------------------
# NOT_FOUND category: PAGE_NOT_FOUND (activity_log.py)
# ---------------------------------------------------------------------------

async def test_activity_log_page_not_found_dual_emit(db_session):
    """존재하지 않는 page id로 canvas_page 활동 조회 → PAGE_NOT_FOUND (not_found, dual-emit)."""
    alice = await _make_user(db_session, "pnf@misc_ec.test", "pnf_misc")
    b = await _make_branch(db_session, alice, name="MB4", key="MCB4")
    cv = await _make_canvas(db_session, b, alice, key="mccv1")
    await _add_canvas_member(db_session, cv, alice)

    res = await al_ctrl.get_canvas_page_activity(cv, 999999, 20, 0, _req(alice), db_session)

    assert res["status"] is False
    assert res["code"] == "PAGE_NOT_FOUND"
    assert res["category"] == "not_found"
    assert res["retryable"] is False
    assert res["message"] == res["code"]
