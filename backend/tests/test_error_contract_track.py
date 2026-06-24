"""Error-contract tests for track controller (SP-2 bulk migration).

Proves that after migrating track.py to error_response(ErrorCode.X) the
unified body shape — status/code/category/message (dual-emit) — is emitted
for one representative path per error category present in this cluster:

  not_found   → TRACK_NOT_FOUND   (get_detail, non-existent track)
  forbidden   → PERMISSION_DENIED (_require_role: non-member update attempt)
  forbidden   → ACCESS_DENIED     (get_detail: private track, non-member)
  validation  → SELF_LINK         (add_link: same item as source and target)
  business    → CANNOT_LEAVE_LAST_OWNER (leave: sole owner tries to leave)

Style: direct controller calls, SimpleNamespace request, raw text() seed
helpers cribbed verbatim from test_idor_track.py.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import track as ctrl
from routers.schema.track import TrackLinkAdd


def _req(user_id: int):
    """controller가 읽는 request.state.payload만 흉내낸다."""
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id}))


# ---------------------------------------------------------------------------
# seed helpers — cribbed verbatim from test_idor_track.py
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


async def _make_track_item(db, track_id, source_task_id):
    row = await db.execute(text("""
        INSERT INTO track_item (track_id, source_type, source_task_id)
        VALUES (:t, 'task', :st) RETURNING item_id
    """), {"t": track_id, "st": source_task_id})
    return row.scalar_one()


# ---------------------------------------------------------------------------
# not_found — TRACK_NOT_FOUND
# ---------------------------------------------------------------------------

async def test_get_detail_track_not_found(db_session):
    """존재하지 않는 track 조회 → TRACK_NOT_FOUND (not_found)."""
    alice = await _make_user(db_session, "alice_ectrk1@test.local", "alice_ectrk1")
    res = await ctrl.get_detail(999_999_999, _req(alice), db_session)

    assert res["status"] is False
    assert res["code"] == "TRACK_NOT_FOUND"
    assert res["category"] == "not_found"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


# ---------------------------------------------------------------------------
# forbidden — PERMISSION_DENIED via _require_role (non-member update)
# ---------------------------------------------------------------------------

async def test_update_permission_denied_non_member(db_session):
    """track 멤버가 아닌 사용자가 update 시도 → PERMISSION_DENIED (forbidden)."""
    alice = await _make_user(db_session, "alice_ectrk2@test.local", "alice_ectrk2")
    bob = await _make_user(db_session, "bob_ectrk2@test.local", "bob_ectrk2")

    track_id = await _make_track(db_session, alice, name="ECTrk2")
    await _add_track_member(db_session, track_id, alice, "owner")
    # bob is NOT a track member

    body = SimpleNamespace(model_dump=lambda exclude_unset: {"track_name": "Renamed"})
    res = await ctrl.update(track_id, body, _req(bob), db_session)

    assert res["status"] is False
    assert res["code"] == "PERMISSION_DENIED"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


# ---------------------------------------------------------------------------
# forbidden — ACCESS_DENIED (private track, non-member get_detail)
# ---------------------------------------------------------------------------

async def test_get_detail_access_denied_private_non_member(db_session):
    """private track을 멤버가 아닌 사용자가 조회 → ACCESS_DENIED (forbidden)."""
    alice = await _make_user(db_session, "alice_ectrk3@test.local", "alice_ectrk3")
    bob = await _make_user(db_session, "bob_ectrk3@test.local", "bob_ectrk3")

    track_id = await _make_track(db_session, alice, name="ECTrk3")
    await _add_track_member(db_session, track_id, alice, "owner")
    # bob is NOT a track member, track is private

    res = await ctrl.get_detail(track_id, _req(bob), db_session)

    assert res["status"] is False
    assert res["code"] == "ACCESS_DENIED"
    assert res["category"] == "forbidden"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


# ---------------------------------------------------------------------------
# validation — SELF_LINK (add_link with same source and target item)
# ---------------------------------------------------------------------------

async def test_add_link_self_link(db_session):
    """source_item_id == target_item_id → SELF_LINK (validation)."""
    alice = await _make_user(db_session, "alice_ectrk4@test.local", "alice_ectrk4")

    branch_id = await _make_branch(db_session, alice, name="ECBrk4", key="ECB4")
    await _add_branch_member(db_session, branch_id, alice, "admin")

    track_id = await _make_track(db_session, alice, name="ECTrk4")
    await _add_track_member(db_session, track_id, alice, "owner")
    await _link_branch(db_session, track_id, branch_id)

    task_id = await _make_task(db_session, branch_id, alice)
    item_id = await _make_track_item(db_session, track_id, task_id)

    body = TrackLinkAdd(source_item_id=item_id, target_item_id=item_id, link_type="flow_to")
    res = await ctrl.add_link(track_id, body, _req(alice), db_session)

    assert res["status"] is False
    assert res["code"] == "SELF_LINK"
    assert res["category"] == "validation"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit


# ---------------------------------------------------------------------------
# business — CANNOT_LEAVE_LAST_OWNER (sole owner tries to leave)
# ---------------------------------------------------------------------------

async def test_leave_cannot_leave_last_owner(db_session):
    """sole owner가 leave 시도 → CANNOT_LEAVE_LAST_OWNER (business)."""
    alice = await _make_user(db_session, "alice_ectrk5@test.local", "alice_ectrk5")

    track_id = await _make_track(db_session, alice, name="ECTrk5")
    await _add_track_member(db_session, track_id, alice, "owner")

    res = await ctrl.leave(track_id, _req(alice), db_session)

    assert res["status"] is False
    assert res["code"] == "CANNOT_LEAVE_LAST_OWNER"
    assert res["category"] == "business"
    assert res["retryable"] is False
    assert res["message"] == res["code"]  # dual-emit
