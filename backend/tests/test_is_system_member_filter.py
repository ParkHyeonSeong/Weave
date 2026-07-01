"""SLICE 0: the seeded 'GitHub' system bot must never surface in member pickers
or invite (non-member) searches. Covers the 5 queries the spec enumerates:
branch_member.find_by_branch + {branch,canvas,scrum,track}_member.search_non_members.
"""
from sqlalchemy import text

from core.model import branch_member as branch_member_model
from core.model import canvas_member as canvas_member_model
from core.model import scrum_member as scrum_member_model
from core.model import track_member as track_member_model


async def _bot_id(db):
    row = await db.execute(text("""
        SELECT user_id FROM "user" WHERE email = 'github-bot@weave.local'
    """))
    return row.scalar_one()


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, ''::bytea, :u, 'active') RETURNING user_id
    """), {"e": email, "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, key="GHF"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES ('Branch', :k, 'd', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"k": key, "u": created_by})
    return row.scalar_one()


async def test_branch_member_list_excludes_bot(db_session):
    bot = await _bot_id(db_session)
    owner = await _make_user(db_session, "owner-bf@x.local", "owner_bf")
    bid = await _make_branch(db_session, owner)
    # add a real member AND the bot to the branch
    await db_session.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, 'admin')
    """), {"b": bid, "u": owner})
    await db_session.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, 'member')
    """), {"b": bid, "u": bot})

    members = await branch_member_model.find_by_branch(bid, db_session)
    ids = {m["user_id"] for m in members}
    assert owner in ids
    assert bot not in ids, "GitHub bot must not appear in branch member list"


async def test_branch_non_member_search_excludes_bot(db_session):
    bot = await _bot_id(db_session)
    owner = await _make_user(db_session, "owner-bn@x.local", "owner_bn")
    bid = await _make_branch(db_session, owner, key="GHN")
    # bot is NOT a member -> would otherwise show as an invitable non-member.
    results = await branch_member_model.search_non_members(bid, "GitHub", db_session)
    ids = {r["user_id"] for r in results}
    assert bot not in ids, "GitHub bot must not be searchable as an invitable user"


async def test_canvas_non_member_search_excludes_bot(db_session):
    bot = await _bot_id(db_session)
    owner = await _make_user(db_session, "owner-cn@x.local", "owner_cn")
    row = await db_session.execute(text("""
        INSERT INTO canvas (canvas_name, key, created_by)
        VALUES ('C', 'GHTST', :u) RETURNING canvas_id
    """), {"u": owner})
    cid = row.scalar_one()
    results = await canvas_member_model.search_non_members(cid, "GitHub", db_session)
    ids = {r["user_id"] for r in results}
    assert bot not in ids


async def test_scrum_non_member_search_excludes_bot(db_session):
    bot = await _bot_id(db_session)
    owner = await _make_user(db_session, "owner-sn@x.local", "owner_sn")
    row = await db_session.execute(text("""
        INSERT INTO scrum_board (name, created_by)
        VALUES ('S', :u) RETURNING board_id
    """), {"u": owner})
    board_id = row.scalar_one()
    results = await scrum_member_model.search_non_members(board_id, "GitHub", db_session)
    ids = {r["user_id"] for r in results}
    assert bot not in ids


async def test_track_non_member_search_excludes_bot(db_session):
    bot = await _bot_id(db_session)
    owner = await _make_user(db_session, "owner-tn@x.local", "owner_tn")
    row = await db_session.execute(text("""
        INSERT INTO track (track_name, created_by)
        VALUES ('T', :u) RETURNING track_id
    """), {"u": owner})
    track_id = row.scalar_one()
    results = await track_member_model.search_non_members(track_id, "GitHub", db_session)
    ids = {r["user_id"] for r in results}
    assert bot not in ids
