"""IDOR regression tests for track.add_items_bulk explicit scope marker (SEC-06).

Style: direct controller-level calls (no HTTP client), seeding with raw INSERTs
via the rollback-isolated ``db_session`` fixture. See test_track_home.py /
test_idor_workflow_status.py for the shared pattern.

Gap: ``add_items_bulk`` enforces track 'editor' role and per-task branch
membership, but when ``scope_mode`` is 'sprint'/'epic' it took the caller's
``scope_id`` and resolved its canonical branch via ``resolve_scope_branch``
WITHOUT checking that branch is (a) one of the track's participating branches
and (b) one the caller is a member of. A track editor could therefore pin a
sprint/epic from a wholly unrelated branch into the track scope (cross-branch
IDOR), surfacing foreign sprint/epic tasks in the sidebar tree.

Fix: after resolving the scope's owner branch, reject if it is not a
participating branch (SCOPE_BRANCH_NOT_PARTICIPATING) or the caller is not a
member of it (NOT_SCOPE_BRANCH_MEMBER); missing scope -> SCOPE_NOT_FOUND.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import track as ctrl
from core.model import track_item as track_item_model
from routers.schema.track import TrackItemsBulkAdd


def _req(user_id: int):
    """controller가 읽는 request.state.payload만 흉내낸다."""
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


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
        INSERT INTO track_branch (track_id, branch_id)
        VALUES (:t, :b)
    """), {"t": track_id, "b": branch_id})


async def _make_task(db, branch_id, created_by, sprint_id=None, status="todo"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, sprint_id, created_by)
        VALUES (:b, :dn, :t, :s, :sp, :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": f"task {dn}", "s": status,
           "sp": sprint_id, "u": created_by})
    return res.scalar_one()


async def _make_sprint(db, branch_id, created_by, name="Sprint", status="active"):
    res = await db.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, goal, start_date, end_date, created_by, status)
        VALUES (:b, :n, 'goal', CURRENT_DATE, CURRENT_DATE + 14, :u, :s)
        RETURNING sprint_id
    """), {"b": branch_id, "n": name, "u": created_by, "s": status})
    return res.scalar_one()


async def _make_track_item(db, track_id, source_task_id):
    row = await db.execute(text("""
        INSERT INTO track_item (track_id, source_type, source_task_id)
        VALUES (:t, 'task', :st) RETURNING item_id
    """), {"t": track_id, "st": source_task_id})
    return row.scalar_one()


async def _scope_rows(db, track_id):
    res = await db.execute(text("""
        SELECT branch_id, scope_type, scope_id FROM track_scope
        WHERE track_id = :t
    """), {"t": track_id})
    return [dict(r._mapping) for r in res.fetchall()]


# ---------------------------------------------------------------------------
# archive — find_by_track restricts tasks whose branch was archived
# ---------------------------------------------------------------------------

async def test_find_by_track_restricts_archived_branch_task(db_session):
    """아카이브된 branch의 task는 track 다이어그램에서 restricted 처리(본문 가림)된다."""
    alice = await _make_user(db_session, "arch@idtrk.test", "arch_idtrk")
    track = await _make_track(db_session, alice, name="TArch")
    await _add_track_member(db_session, track, alice, "owner")

    b_live = await _make_branch(db_session, alice, name="Live", key="ITARL")
    await _add_branch_member(db_session, b_live, alice, "admin")
    await _link_branch(db_session, track, b_live)
    t_live = await _make_task(db_session, b_live, alice)
    await _make_track_item(db_session, track, t_live)

    b_arch = await _make_branch(db_session, alice, name="Arch", key="ITARA")
    await _add_branch_member(db_session, b_arch, alice, "admin")
    await _link_branch(db_session, track, b_arch)
    t_arch = await _make_task(db_session, b_arch, alice)
    item_arch = await _make_track_item(db_session, track, t_arch)
    await db_session.execute(text("UPDATE branch SET is_archived = TRUE WHERE branch_id = :b"),
                             {"b": b_arch})

    items = await track_item_model.find_by_track(track, alice, db_session)
    arch_item = next(i for i in items if i["item_id"] == item_arch)
    live_by_task = {i.get("task_id"): i for i in items if i.get("task_id")}

    # 아카이브 branch task: restricted=True, title/status 등 본문 가림
    assert arch_item["restricted"] is True
    assert "title" not in arch_item
    # 살아있는 branch task: 정상 노출 (회귀)
    assert t_live in live_by_task
    assert live_by_task[t_live]["restricted"] is False
    assert live_by_task[t_live]["title"]


# ---------------------------------------------------------------------------
# IDOR — scope branch is NOT one of the track's participating branches
# ---------------------------------------------------------------------------

async def test_bulk_add_rejects_scope_from_non_participating_branch(db_session):
    """track editor가 track에 연결 안 된 branch의 sprint를 scope로 추가 시도 → 거부."""
    alice = await _make_user(db_session, "alice@idtrk.test", "alice_idtrk")
    bob = await _make_user(db_session, "bob@idtrk.test", "bob_idtrk")

    branch1 = await _make_branch(db_session, alice, name="B1", key="ITB1")
    await _add_branch_member(db_session, branch1, alice, "admin")

    # branch2: alice는 멤버가 아니고 track에도 연결 안 됨
    branch2 = await _make_branch(db_session, bob, name="B2", key="ITB2")
    await _add_branch_member(db_session, branch2, bob, "admin")

    track = await _make_track(db_session, alice, name="T1")
    await _add_track_member(db_session, track, alice, "editor")
    await _link_branch(db_session, track, branch1)  # branch1만 participating

    task1 = await _make_task(db_session, branch1, alice)
    sprint2 = await _make_sprint(db_session, branch2, bob, name="S2")

    res = await ctrl.add_items_bulk(
        track,
        TrackItemsBulkAdd(source_task_ids=[task1], scope_mode="sprint", scope_id=sprint2),
        _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] in ("SCOPE_BRANCH_NOT_PARTICIPATING", "NOT_SCOPE_BRANCH_MEMBER")

    # branch2 sprint이 track scope에 박히지 않아야 함
    scopes = await _scope_rows(db_session, track)
    assert all(s["branch_id"] != branch2 for s in scopes)


# ---------------------------------------------------------------------------
# IDOR variant — scope branch participates but caller is NOT its member
# ---------------------------------------------------------------------------

async def test_bulk_add_rejects_scope_when_caller_not_branch_member(db_session):
    """branch2가 track에 연결됐지만 alice가 branch2 멤버가 아니면 거부."""
    alice = await _make_user(db_session, "alice2@idtrk.test", "alice2_idtrk")
    bob = await _make_user(db_session, "bob2@idtrk.test", "bob2_idtrk")

    branch1 = await _make_branch(db_session, alice, name="B1", key="ITC1")
    await _add_branch_member(db_session, branch1, alice, "admin")

    branch2 = await _make_branch(db_session, bob, name="B2", key="ITC2")
    await _add_branch_member(db_session, branch2, bob, "admin")

    track = await _make_track(db_session, alice, name="TShared")
    await _add_track_member(db_session, track, alice, "editor")
    await _link_branch(db_session, track, branch1)
    await _link_branch(db_session, track, branch2)  # participating, but alice not a member

    task1 = await _make_task(db_session, branch1, alice)
    sprint2 = await _make_sprint(db_session, branch2, bob, name="S2")

    res = await ctrl.add_items_bulk(
        track,
        TrackItemsBulkAdd(source_task_ids=[task1], scope_mode="sprint", scope_id=sprint2),
        _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "NOT_SCOPE_BRANCH_MEMBER"

    scopes = await _scope_rows(db_session, track)
    assert all(s["branch_id"] != branch2 for s in scopes)


# ---------------------------------------------------------------------------
# regression — legitimate scope from a participating branch still works
# ---------------------------------------------------------------------------

async def test_bulk_add_explicit_sprint_scope_same_branch_succeeds(db_session):
    """연결된 branch의 sprint를 명시적 scope로 bulk add → 정상 등록."""
    alice = await _make_user(db_session, "alice_ok@idtrk.test", "alice_ok_idtrk")

    branch1 = await _make_branch(db_session, alice, name="B1", key="ITO1")
    await _add_branch_member(db_session, branch1, alice, "admin")

    track = await _make_track(db_session, alice, name="TOk")
    await _add_track_member(db_session, track, alice, "editor")
    await _link_branch(db_session, track, branch1)

    sprint1 = await _make_sprint(db_session, branch1, alice, name="S1")
    task1 = await _make_task(db_session, branch1, alice, sprint_id=sprint1)

    res = await ctrl.add_items_bulk(
        track,
        TrackItemsBulkAdd(source_task_ids=[task1], scope_mode="sprint", scope_id=sprint1),
        _req(alice), db_session,
    )
    assert res["status"] is True
    assert res["added"] >= 1

    scopes = await _scope_rows(db_session, track)
    assert any(
        s["branch_id"] == branch1 and s["scope_type"] == "sprint" and s["scope_id"] == sprint1
        for s in scopes
    )


async def test_bulk_add_filter_mode_auto_sprint_scope_succeeds(db_session):
    """scope_mode 미지정(filter) — task의 sprint를 자동 scope로 등록 (회귀)."""
    alice = await _make_user(db_session, "alice_f@idtrk.test", "alice_f_idtrk")

    branch1 = await _make_branch(db_session, alice, name="B1", key="ITF1")
    await _add_branch_member(db_session, branch1, alice, "admin")

    track = await _make_track(db_session, alice, name="TFilter")
    await _add_track_member(db_session, track, alice, "editor")
    await _link_branch(db_session, track, branch1)

    sprint1 = await _make_sprint(db_session, branch1, alice, name="S1")
    task1 = await _make_task(db_session, branch1, alice, sprint_id=sprint1)

    res = await ctrl.add_items_bulk(
        track,
        TrackItemsBulkAdd(source_task_ids=[task1], scope_mode="filter"),
        _req(alice), db_session,
    )
    assert res["status"] is True
    assert res["added"] >= 1

    scopes = await _scope_rows(db_session, track)
    assert any(
        s["branch_id"] == branch1 and s["scope_type"] == "sprint" and s["scope_id"] == sprint1
        for s in scopes
    )
