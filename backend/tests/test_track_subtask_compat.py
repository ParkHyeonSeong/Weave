"""Track × 하위태스크 1급 시민화 회귀 테스트.

하위태스크는 자기 sprint_id/epic_id가 NULL(부모 라이브 파생 불변식)이므로
Track의 스프린트 연관 쿼리는 전부 부모 조인으로 해석해야 한다.
Style: controller/model 직접 호출, raw INSERT seed (test_idor_track.py 패턴).
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import track as ctrl
from core.model import track_scope as track_scope_model
from core.model import track_item as track_item_model
from routers.schema.track import TrackItemAdd, TrackItemsBulkAdd


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


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


async def _make_track(db, created_by, name="Track"):
    row = await db.execute(text("""
        INSERT INTO track (track_name, description, color, visibility, default_view, created_by)
        VALUES (:n, 'desc', '#0D9488', 'private', 'flow', :u) RETURNING track_id
    """), {"n": name, "u": created_by})
    return row.scalar_one()


async def _add_track_member(db, track_id, user_id, role="owner"):
    await db.execute(text("""
        INSERT INTO track_member (track_id, user_id, role)
        VALUES (:t, :u, :r)
    """), {"t": track_id, "u": user_id, "r": role})


async def _link_branch(db, track_id, branch_id):
    await db.execute(text("""
        INSERT INTO track_branch (track_id, branch_id) VALUES (:t, :b)
    """), {"t": track_id, "b": branch_id})


async def _make_sprint(db, branch_id, created_by, name="Sprint", status="active"):
    res = await db.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, goal, start_date, end_date, created_by, status)
        VALUES (:b, :n, 'goal', CURRENT_DATE, CURRENT_DATE + 14, :u, :s)
        RETURNING sprint_id
    """), {"b": branch_id, "n": name, "u": created_by, "s": status})
    return res.scalar_one()


async def _make_epic(db, branch_id, created_by, name="Epic"):
    res = await db.execute(text("""
        INSERT INTO epic (branch_id, epic_name, created_by)
        VALUES (:b, :n, :u) RETURNING epic_id
    """), {"b": branch_id, "n": name, "u": created_by})
    return res.scalar_one()


async def _make_task(db, branch_id, created_by, sprint_id=None, epic_id=None,
                     status="todo", parent_task_id=None, title=None):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, sprint_id,
                          epic_id, parent_task_id, created_by)
        VALUES (:b, :dn, :t, :s, :sp, :e, :p, :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title or f"task {dn}", "s": status,
           "sp": sprint_id, "e": epic_id, "p": parent_task_id, "u": created_by})
    return res.scalar_one()


async def _make_track_item(db, track_id, source_task_id):
    row = await db.execute(text("""
        INSERT INTO track_item (track_id, source_type, source_task_id)
        VALUES (:t, 'task', :st) RETURNING item_id
    """), {"t": track_id, "st": source_task_id})
    return row.scalar_one()


async def _add_scope(db, track_id, branch_id, scope_type, scope_id):
    await db.execute(text("""
        INSERT INTO track_scope (track_id, branch_id, scope_type, scope_id)
        VALUES (:t, :b, :st, :si)
    """), {"t": track_id, "b": branch_id, "st": scope_type, "si": scope_id})


async def _seed_base(db):
    """user + branch(멤버) + track(owner) + participating. 반환: (user, branch, track)."""
    user = await _make_user(db, "a@x.com", "alice")
    branch = await _make_branch(db, user)
    await _add_branch_member(db, branch, user)
    track = await _make_track(db, user)
    await _add_track_member(db, track, user)
    await _link_branch(db, track, branch)
    return user, branch, track


# ---------------------------------------------------------------------------
# Task 1: sidebar tree nests subtasks
# ---------------------------------------------------------------------------

async def test_tree_nests_subtasks_under_parent(db_session):
    """active sprint scope: 부모 밑에 subtasks[] 동봉, done 하위도 포함(active 규칙)."""
    user, branch, track = await _seed_base(db_session)
    sprint = await _make_sprint(db_session, branch, user, status="active")
    parent = await _make_task(db_session, branch, user, sprint_id=sprint, title="Parent")
    sub_todo = await _make_task(db_session, branch, user, parent_task_id=parent, title="Sub A")
    sub_done = await _make_task(db_session, branch, user, parent_task_id=parent,
                                status="done", title="Sub B")
    await _add_scope(db_session, track, branch, "sprint", sprint)
    await _make_track_item(db_session, track, sub_todo)

    tree = await track_scope_model.find_tree(track, user, db_session)
    tasks = tree[0]["sprints"][0]["tasks"]
    assert [t["task_id"] for t in tasks] == [parent]
    subs = tasks[0]["subtasks"]
    assert {s["task_id"] for s in subs} == {sub_todo, sub_done}
    by_id = {s["task_id"]: s for s in subs}
    assert by_id[sub_todo]["in_track"] is True
    assert by_id[sub_done]["in_track"] is False
    assert by_id[sub_todo]["display_id"].startswith("KEY-")
    assert by_id[sub_todo]["branch_id"] == branch


async def test_tree_subtask_done_rule_follows_parent_sprint(db_session):
    """비-active sprint: done/cancelled 하위는 제외, todo 하위는 포함."""
    user, branch, track = await _seed_base(db_session)
    sprint = await _make_sprint(db_session, branch, user, status="planned")
    parent = await _make_task(db_session, branch, user, sprint_id=sprint, title="Parent")
    sub_todo = await _make_task(db_session, branch, user, parent_task_id=parent)
    sub_done = await _make_task(db_session, branch, user, parent_task_id=parent, status="done")
    await _add_scope(db_session, track, branch, "sprint", sprint)

    tree = await track_scope_model.find_tree(track, user, db_session)
    subs = tree[0]["sprints"][0]["tasks"][0]["subtasks"]
    assert [s["task_id"] for s in subs] == [sub_todo]


# ---------------------------------------------------------------------------
# Task 2: search_sources subtask support
# ---------------------------------------------------------------------------

async def test_search_sources_sprint_mode_attaches_subtasks(db_session):
    """sprint_id 지정 검색: 상위에 subtasks 동봉. parent_only=True면 부착 생략."""
    user, branch, track = await _seed_base(db_session)
    sprint = await _make_sprint(db_session, branch, user, status="active")
    parent = await _make_task(db_session, branch, user, sprint_id=sprint, title="Parent")
    sub = await _make_task(db_session, branch, user, parent_task_id=parent, title="Sub")

    rows = await track_item_model.search_sources(
        track, user, '', None, 50, db_session, sprint_id=sprint)
    assert [r["task_id"] for r in rows] == [parent]
    assert [s["task_id"] for s in rows[0]["subtasks"]] == [sub]
    assert rows[0]["subtasks"][0]["in_track"] is False

    rows_po = await track_item_model.search_sources(
        track, user, '', None, 50, db_session, sprint_id=sprint, parent_only=True)
    assert "subtasks" not in rows_po[0]


async def test_search_sources_filter_mode_includes_subtasks_flat(db_session):
    """필터/키워드 모드: 하위가 독립 매칭 + 부모 컨텍스트 필드. parent_only는 제외."""
    user, branch, track = await _seed_base(db_session)
    parent = await _make_task(db_session, branch, user, title="Parent task")
    sub = await _make_task(db_session, branch, user, parent_task_id=parent,
                           title="OAuth sub work")

    rows = await track_item_model.search_sources(
        track, user, 'OAuth', None, 50, db_session)
    assert [r["task_id"] for r in rows] == [sub]
    assert rows[0]["parent_task_id"] == parent
    assert rows[0]["parent_title"] == "Parent task"
    assert rows[0]["parent_display_id"].startswith("KEY-")

    rows_po = await track_item_model.search_sources(
        track, user, 'OAuth', None, 50, db_session, parent_only=True)
    assert rows_po == []


async def test_search_sources_subtask_exclude_done_applies(db_session):
    """sprint 모드 동봉 하위에도 exclude_done 파라미터가 적용된다."""
    user, branch, track = await _seed_base(db_session)
    sprint = await _make_sprint(db_session, branch, user, status="planned")
    parent = await _make_task(db_session, branch, user, sprint_id=sprint, title="Parent")
    sub_todo = await _make_task(db_session, branch, user, parent_task_id=parent)
    await _make_task(db_session, branch, user, parent_task_id=parent, status="done")

    rows = await track_item_model.search_sources(
        track, user, '', None, 50, db_session, sprint_id=sprint, exclude_done=True)
    assert [s["task_id"] for s in rows[0]["subtasks"]] == [sub_todo]


async def test_search_sources_sprint_child_only_match_stays_flat(db_session):
    """sprint 모드에서 q가 하위만 매칭하면(부모 미매칭) 하위가 부모 컨텍스트를 단
    플랫 row로 나온다 — 부모 우선(CASE WHEN) 매칭 계약 (스펙 §2)."""
    user, branch, track = await _seed_base(db_session)
    sprint = await _make_sprint(db_session, branch, user, status="active")
    parent = await _make_task(db_session, branch, user, sprint_id=sprint, title="Parent")
    sub = await _make_task(db_session, branch, user, parent_task_id=parent,
                           title="OAuth sub")

    rows = await track_item_model.search_sources(
        track, user, 'OAuth', None, 50, db_session, sprint_id=sprint)
    assert [r["task_id"] for r in rows] == [sub]
    assert rows[0]["parent_task_id"] == parent
    assert rows[0]["parent_display_id"].startswith("KEY-")


async def test_search_sources_epic_mode_nests_without_duplicates(db_session):
    """epic 모드: 부모 우선 epic 매칭 + 부모+하위 동시 매칭 시 하위는 중첩으로만
    나오고 플랫 row로 중복되지 않는다 (dedup 고정)."""
    user, branch, track = await _seed_base(db_session)
    epic = await _make_epic(db_session, branch, user)
    parent = await _make_task(db_session, branch, user, epic_id=epic, title="Parent")
    sub = await _make_task(db_session, branch, user, parent_task_id=parent, title="Sub")

    rows = await track_item_model.search_sources(
        track, user, '', None, 50, db_session, epic_id=epic)
    # 플랫 레벨엔 부모 한 건만 — 하위가 flat+nested로 이중 등장하지 않는다.
    assert [r["task_id"] for r in rows] == [parent]
    assert [s["task_id"] for s in rows[0]["subtasks"]] == [sub]


async def test_search_sources_limit_cut_parent_child_stays_flat(db_session):
    """부모가 limit에 잘려 결과에 없으면 하위는 부모 컨텍스트를 단 플랫 row로
    유지된다. 같은 트랜잭션 시딩은 created_at이 동일해 정렬이 비결정적이므로
    하위의 updated_at을 명시해 정렬(updated_at DESC NULLS LAST) 1순위로 고정."""
    user, branch, track = await _seed_base(db_session)
    sprint = await _make_sprint(db_session, branch, user, status="active")
    parent = await _make_task(db_session, branch, user, sprint_id=sprint, title="Parent")
    sub = await _make_task(db_session, branch, user, parent_task_id=parent, title="Sub")
    await db_session.execute(text(
        "UPDATE task SET updated_at = NOW() WHERE task_id = :t"), {"t": sub})

    rows = await track_item_model.search_sources(
        track, user, '', None, 1, db_session, sprint_id=sprint)
    assert [r["task_id"] for r in rows] == [sub]
    assert rows[0]["parent_task_id"] == parent
    assert "subtasks" not in rows[0]


async def test_search_sources_child_stale_sprint_ignored(db_session):
    """레거시 stale 데이터: 하위가 자기 sprint_id를 갖고 있어도(과거 전환이 NULL을
    강제하지 않던 잔재) 부모의 sprint로만 매칭된다 — 부모 우선(CASE WHEN) 읽기 계약."""
    user, branch, track = await _seed_base(db_session)
    stale_sprint = await _make_sprint(db_session, branch, user, name="Stale", status="active")
    real_sprint = await _make_sprint(db_session, branch, user, name="Real", status="active")
    parent = await _make_task(db_session, branch, user, sprint_id=real_sprint, title="Parent")
    sub = await _make_task(db_session, branch, user, parent_task_id=parent, title="Sub")
    await db_session.execute(text(
        "UPDATE task SET sprint_id = :s WHERE task_id = :t"),
        {"s": stale_sprint, "t": sub})

    stale_rows = await track_item_model.search_sources(
        track, user, '', None, 50, db_session, sprint_id=stale_sprint)
    assert stale_rows == []
    real_rows = await track_item_model.search_sources(
        track, user, '', None, 50, db_session, sprint_id=real_sprint)
    assert [s["task_id"] for s in real_rows[0]["subtasks"]] == [sub]


# ---------------------------------------------------------------------------
# Task 3: auto sprint scope falls back to parent's sprint
# ---------------------------------------------------------------------------

async def _scope_rows(db, track_id):
    res = await db.execute(text("""
        SELECT branch_id, scope_type, scope_id FROM track_scope
        WHERE track_id = :t ORDER BY scope_id
    """), {"t": track_id})
    return [dict(r._mapping) for r in res.fetchall()]


async def test_bulk_add_subtask_registers_parent_sprint_scope(db_session):
    """하위태스크만 bulk add해도 부모의 sprint가 자동 scope 등록된다."""
    user, branch, track = await _seed_base(db_session)
    sprint = await _make_sprint(db_session, branch, user, status="active")
    parent = await _make_task(db_session, branch, user, sprint_id=sprint, title="Parent")
    sub = await _make_task(db_session, branch, user, parent_task_id=parent)

    body = TrackItemsBulkAdd(source_task_ids=[sub], scope_mode='filter')
    res = await ctrl.add_items_bulk(track, body, _req(user), db_session)
    assert res['status'] is True and res['added'] == 1
    scopes = await _scope_rows(db_session, track)
    assert scopes == [{'branch_id': branch, 'scope_type': 'sprint', 'scope_id': sprint}]


async def test_bulk_add_subtask_of_backlog_parent_skips_scope(db_session):
    """부모가 백로그(sprint 없음)인 하위는 scope 등록을 스킵한다 (기존 백로그 규칙)."""
    user, branch, track = await _seed_base(db_session)
    parent = await _make_task(db_session, branch, user, title="Backlog parent")
    sub = await _make_task(db_session, branch, user, parent_task_id=parent)

    body = TrackItemsBulkAdd(source_task_ids=[sub], scope_mode='filter')
    res = await ctrl.add_items_bulk(track, body, _req(user), db_session)
    assert res['status'] is True and res['added'] == 1
    assert await _scope_rows(db_session, track) == []


async def test_drag_add_item_registers_parent_sprint_scope(db_session):
    """단일 드래그/MCP 경로(add_item)도 bulk와 동일하게 sprint scope 자동 등록 —
    하위는 부모의 sprint로 매칭(부모 우선) (add_item은 기존에 scope 등록 자체가 누락)."""
    user, branch, track = await _seed_base(db_session)
    sprint = await _make_sprint(db_session, branch, user, status="active")
    parent = await _make_task(db_session, branch, user, sprint_id=sprint, title="Parent")
    sub = await _make_task(db_session, branch, user, parent_task_id=parent)

    body = TrackItemAdd(source_task_id=sub, position_x=10, position_y=20)
    res = await ctrl.add_item(track, body, _req(user), db_session)
    assert res['status'] is True
    scopes = await _scope_rows(db_session, track)
    assert scopes == [{'branch_id': branch, 'scope_type': 'sprint', 'scope_id': sprint}]
