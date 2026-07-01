"""task_transition service — gate(open/merge/close)→category→key 해석 + CAS + 부수효과.

Style: model-level seeding via rollback-isolated db_session (see test_idor_ref_status.py).
notify/activity는 실제 DB(activity_log/notification)에 기록되므로, 그 행 수를 세서
부수효과가 '이동했을 때만' 발사되는지 검증한다.

게이트 매핑:
  open  → 목표 category in_progress, 허용 현재 {todo}
  merge → 목표 category done,        허용 현재 {todo, in_progress}
  close → 목표 category todo,         허용 현재 {in_progress} (단, 다른 활성 PR 없을 때)
"""
from sqlalchemy import text

from core.service import task_transition
from core.model import task as task_model


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, key="KEY", seed_status=True):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES ('B', :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"k": key, "u": created_by})
    bid = row.scalar_one()
    if seed_status:
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
        INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by, status="todo"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, 'T', :s, :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "s": status, "u": created_by})
    return res.scalar_one()


async def _assign(db, task_id, user_id, role="main"):
    await db.execute(text("""
        INSERT INTO task_assignee (task_id, user_id, role) VALUES (:t, :u, :r)
    """), {"t": task_id, "u": user_id, "r": role})


async def _status(db, task_id):
    row = await db.execute(text("SELECT status FROM task WHERE task_id = :t"), {"t": task_id})
    return row.scalar_one()


async def _activity_count(db, task_id):
    row = await db.execute(text("""
        SELECT COUNT(*) FROM activity_log WHERE entity_type='task' AND entity_id=:t
    """), {"t": task_id})
    return row.scalar_one()


async def _seed_pr_ref(db, task_id, state, number):
    """059 task_github_ref에 PR 링크 1행 시드 (close 게이트의 '다른 활성 PR' 검사용)."""
    res = await db.execute(text("""
        INSERT INTO task_github_ref
            (task_id, repo_full_name, ref_type, ref_number, state, html_url, linked_by)
        VALUES (:t, 'org/repo', 'pull_request', :n, :s, 'https://x', NULL)
        RETURNING ref_id
    """), {"t": task_id, "n": number, "s": state})
    return res.scalar_one()


# --- open 게이트 ---------------------------------------------------------

async def test_open_gate_moves_todo_to_in_progress(db_session):
    bot = await _make_user(db_session, "bot_o@tt.test", "bot_o")
    b = await _make_branch(db_session, bot, key="TTO")
    await _add_member(db_session, b, bot, "admin")
    t = await _make_task(db_session, b, bot, status="todo")

    out = await task_transition.transition(t, b, "open", bot, db_session)
    assert out["status"] is True
    assert out["moved"] is True
    assert await _status(db_session, t) == "in_progress"
    assert await _activity_count(db_session, t) == 1  # 이동 시에만 1건 로그


async def test_open_gate_forward_only_done_not_moved(db_session):
    """이미 done인 task에 open 게이트 → 허용 {todo}에 없어 not moved + 부수효과 0."""
    bot = await _make_user(db_session, "bot_f@tt.test", "bot_f")
    b = await _make_branch(db_session, bot, key="TTF")
    await _add_member(db_session, b, bot, "admin")
    t = await _make_task(db_session, b, bot, status="done")

    out = await task_transition.transition(t, b, "open", bot, db_session)
    assert out["status"] is True
    assert out["moved"] is False
    assert await _status(db_session, t) == "done"      # 사람이 옮긴 done 보존
    assert await _activity_count(db_session, t) == 0    # 부수효과 미발사


# --- merge 게이트 --------------------------------------------------------

async def test_merge_gate_moves_in_progress_to_done(db_session):
    bot = await _make_user(db_session, "bot_m@tt.test", "bot_m")
    b = await _make_branch(db_session, bot, key="TTM")
    await _add_member(db_session, b, bot, "admin")
    t = await _make_task(db_session, b, bot, status="in_progress")

    out = await task_transition.transition(t, b, "merge", bot, db_session)
    assert out["moved"] is True
    assert await _status(db_session, t) == "done"


async def test_merge_gate_from_todo_also_moves(db_session):
    """merge 허용은 {todo, in_progress} — PR이 곧장 머지된 todo도 done으로."""
    bot = await _make_user(db_session, "bot_m2@tt.test", "bot_m2")
    b = await _make_branch(db_session, bot, key="TTM2")
    await _add_member(db_session, b, bot, "admin")
    t = await _make_task(db_session, b, bot, status="todo")

    out = await task_transition.transition(t, b, "merge", bot, db_session)
    assert out["moved"] is True
    assert await _status(db_session, t) == "done"


# --- 알림 발사(담당자) ---------------------------------------------------

async def test_moved_notifies_assignees(db_session):
    """이동 시 담당자에게 notify_bulk → notification 1행(actor=bot 제외 대상은 다른 유저)."""
    bot = await _make_user(db_session, "bot_n@tt.test", "bot_n")
    dev = await _make_user(db_session, "dev_n@tt.test", "dev_n")
    b = await _make_branch(db_session, bot, key="TTN")
    await _add_member(db_session, b, bot, "admin")
    await _add_member(db_session, b, dev, "member")
    t = await _make_task(db_session, b, bot, status="in_progress")
    await _assign(db_session, t, dev, "main")

    out = await task_transition.transition(t, b, "merge", bot, db_session)
    assert out["moved"] is True
    n = await db_session.execute(text("""
        SELECT COUNT(*) FROM notification WHERE entity_type='task' AND entity_id=:t AND user_id=:u
    """), {"t": t, "u": dev})
    assert n.scalar_one() == 1


# --- close 게이트 + 다른 활성 PR -----------------------------------------

async def test_close_gate_moves_when_no_other_active_pr(db_session):
    """머지 없이 닫힘 + in_progress + 다른 활성 PR 없음 → todo 복귀."""
    bot = await _make_user(db_session, "bot_c@tt.test", "bot_c")
    b = await _make_branch(db_session, bot, key="TTC")
    await _add_member(db_session, b, bot, "admin")
    t = await _make_task(db_session, b, bot, status="in_progress")
    this_ref = await _seed_pr_ref(db_session, t, "closed", 1)  # 이 PR은 이미 closed

    out = await task_transition.transition(t, b, "close", bot, db_session, this_ref_id=this_ref)
    assert out["moved"] is True
    assert await _status(db_session, t) == "todo"


async def test_close_gate_blocked_by_other_active_pr(db_session):
    """다른 PR이 아직 open이면 close 게이트는 todo로 되돌리지 않는다(not moved)."""
    bot = await _make_user(db_session, "bot_c2@tt.test", "bot_c2")
    b = await _make_branch(db_session, bot, key="TTC2")
    await _add_member(db_session, b, bot, "admin")
    t = await _make_task(db_session, b, bot, status="in_progress")
    this_ref = await _seed_pr_ref(db_session, t, "closed", 1)
    await _seed_pr_ref(db_session, t, "open", 2)  # 다른 활성 PR

    out = await task_transition.transition(t, b, "close", bot, db_session, this_ref_id=this_ref)
    assert out["moved"] is False
    assert await _status(db_session, t) == "in_progress"
    assert await _activity_count(db_session, t) == 0


# --- target category 없는 브랜치 → skip ----------------------------------

async def test_target_category_missing_is_skip_not_error(db_session):
    """브랜치에 done category status가 없으면 merge 게이트는 조용히 skip(not moved)."""
    bot = await _make_user(db_session, "bot_s@tt.test", "bot_s")
    b = await _make_branch(db_session, bot, key="TTS", seed_status=False)
    await _add_member(db_session, b, bot, "admin")
    # done category 없이 todo/in_progress만 시드
    for key_, cat, sort in [("todo", "todo", 0), ("doing", "in_progress", 1)]:
        await db_session.execute(text("""
            INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order)
            VALUES (:b, :k, :k, '#000', :c, :s)
        """), {"b": b, "k": key_, "c": cat, "s": sort})
    t = await _make_task(db_session, b, bot, status="doing")

    out = await task_transition.transition(t, b, "merge", bot, db_session)
    assert out["status"] is True
    assert out["moved"] is False           # 목표 category 없음 → skip
    assert await _status(db_session, t) == "doing"
