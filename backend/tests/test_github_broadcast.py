"""broadcast_to_branch fans out to branch members only (mirrors broadcast_to_room)."""
from sqlalchemy import text

from library.ws_manager import ConnectionManager


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, key="BCKEY"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES ('B', :k, 'd', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"k": key, "u": created_by})
    return row.scalar_one()


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def test_broadcast_to_branch_hits_members_only(db_session):
    alice = await _make_user(db_session, "al_bc@gh.test", "al_bc")
    bob = await _make_user(db_session, "bo_bc@gh.test", "bo_bc")
    carol = await _make_user(db_session, "ca_bc@gh.test", "ca_bc")
    bid = await _make_branch(db_session, alice)
    await _add_member(db_session, bid, alice)
    await _add_member(db_session, bid, bob)
    # carol is NOT a member

    mgr = ConnectionManager()
    sent: dict[int, list[dict]] = {}

    async def _capture(uid, data):
        sent.setdefault(uid, []).append(data)

    mgr.send_to_user = _capture  # type: ignore[assignment]

    await mgr.broadcast_to_branch(bid, {"type": "task_updated", "task_id": 7}, db_session)

    assert alice in sent and bob in sent
    assert carol not in sent
    assert sent[alice][0]["type"] == "task_updated"
    assert sent[alice][0]["task_id"] == 7
