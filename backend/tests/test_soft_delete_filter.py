"""LOG-04: soft-deleted(삭제된) 사용자가 조회/멤버목록/담당자/초대검색에 노출되지 않는다.

- user.find_by_id / find_by_id_with_password / get_ui_prefs → 삭제 후 None
- 멤버 목록(branch/canvas/track/chat/scrum)에서 삭제된 멤버 제외
- 초대 검색(search_non_members)에서 삭제된 사용자 제외
- task 담당자 hydrate에서 삭제된 담당자 제외
작성자/액터 귀속(comment author 등)은 의도적으로 유지하므로 본 슬라이스 대상이 아니다.
"""
import bcrypt
from sqlalchemy import text

from core.model import user as user_model
from core.model import branch_member, canvas_member, track_member, chat_member, scrum_member
from core.model import task as task_model


async def _user(db, username, email):
    pw = bcrypt.hashpw(b"x", bcrypt.gensalt())
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES (:e, :p, :u, 'active', 'member') RETURNING user_id
    """), {"e": email, "p": pw, "u": username})
    return row.scalar_one()


async def _branch(db, creator, key, visibility='private'):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES ('B', :k, 'd', :v, '#5E6AD2', :u) RETURNING branch_id
    """), {"k": key, "v": visibility, "u": creator})
    return row.scalar_one()


async def _canvas(db, branch_id, creator, key):
    row = await db.execute(text("""
        INSERT INTO canvas (branch_id, canvas_name, key, visibility, created_by)
        VALUES (:b, 'C', :k, 'private', :u) RETURNING canvas_id
    """), {"b": branch_id, "k": key, "u": creator})
    return row.scalar_one()


async def _track(db, creator):
    row = await db.execute(text("""
        INSERT INTO track (track_name, description, color, visibility, default_view, created_by)
        VALUES ('T', 'd', '#5E6AD2', 'private', 'flow', :u) RETURNING track_id
    """), {"u": creator})
    return row.scalar_one()


async def _board(db, creator):
    row = await db.execute(text("""
        INSERT INTO scrum_board (name, visibility, created_by) VALUES ('SB', 'private', :u) RETURNING board_id
    """), {"u": creator})
    return row.scalar_one()


async def _room(db, creator):
    row = await db.execute(text("""
        INSERT INTO chat_room (room_type, room_name, created_by) VALUES ('group', 'R', :u) RETURNING room_id
    """), {"u": creator})
    return row.scalar_one()


async def _task(db, branch_id, creator):
    row = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, 1, 'T', 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "u": creator})
    return row.scalar_one()


async def _ins(db, sql, **p):
    await db.execute(text(sql), p)


# ── user 직접 조회: 삭제 후 None ───────────────────────────────────────────

async def test_find_by_id_excludes_soft_deleted(db_session):
    uid = await _user(db_session, "del01", "del01@t.local")
    assert await user_model.find_by_id(uid, db_session) is not None
    await user_model.soft_delete(uid, db_session)
    assert await user_model.find_by_id(uid, db_session) is None


async def test_find_by_id_with_password_excludes_soft_deleted(db_session):
    uid = await _user(db_session, "del02", "del02@t.local")
    await user_model.soft_delete(uid, db_session)
    assert await user_model.find_by_id_with_password(uid, db_session) is None


async def test_get_ui_prefs_excludes_soft_deleted(db_session):
    uid = await _user(db_session, "del03", "del03@t.local")
    await user_model.soft_delete(uid, db_session)
    assert await user_model.get_ui_prefs(uid, db_session) is None


# ── 멤버 목록: 삭제된 멤버 제외 ────────────────────────────────────────────

async def test_branch_members_exclude_soft_deleted(db_session):
    owner = await _user(db_session, "delb1", "delb1@t.local")
    gone = await _user(db_session, "delb2", "delb2@t.local")
    br = await _branch(db_session, owner, "DLB")
    await _ins(db_session, "INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b,:u,'admin')", b=br, u=owner)
    await _ins(db_session, "INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b,:u,'member')", b=br, u=gone)
    await user_model.soft_delete(gone, db_session)
    members = await branch_member.find_by_branch(br, db_session)
    ids = [m['user_id'] for m in members]
    assert owner in ids and gone not in ids


async def test_canvas_members_exclude_soft_deleted(db_session):
    owner = await _user(db_session, "delc1", "delc1@t.local")
    gone = await _user(db_session, "delc2", "delc2@t.local")
    br = await _branch(db_session, owner, "DLC")
    cv = await _canvas(db_session, br, owner, "DLCC")
    await _ins(db_session, "INSERT INTO canvas_member (canvas_id, user_id, role) VALUES (:c,:u,'admin')", c=cv, u=owner)
    await _ins(db_session, "INSERT INTO canvas_member (canvas_id, user_id, role) VALUES (:c,:u,'member')", c=cv, u=gone)
    await user_model.soft_delete(gone, db_session)
    members = await canvas_member.find_by_canvas(cv, db_session)
    assert gone not in [m['user_id'] for m in members]


async def test_track_members_exclude_soft_deleted(db_session):
    owner = await _user(db_session, "delt1", "delt1@t.local")
    gone = await _user(db_session, "delt2", "delt2@t.local")
    tr = await _track(db_session, owner)
    await _ins(db_session, "INSERT INTO track_member (track_id, user_id, role) VALUES (:t,:u,'owner')", t=tr, u=owner)
    await _ins(db_session, "INSERT INTO track_member (track_id, user_id, role) VALUES (:t,:u,'editor')", t=tr, u=gone)
    await user_model.soft_delete(gone, db_session)
    members = await track_member.find_by_track(tr, db_session)
    assert gone not in [m['user_id'] for m in members]


async def test_chat_room_members_exclude_soft_deleted(db_session):
    owner = await _user(db_session, "delr1", "delr1@t.local")
    gone = await _user(db_session, "delr2", "delr2@t.local")
    room = await _room(db_session, owner)
    await _ins(db_session, "INSERT INTO chat_room_member (room_id, user_id) VALUES (:r,:u)", r=room, u=owner)
    await _ins(db_session, "INSERT INTO chat_room_member (room_id, user_id) VALUES (:r,:u)", r=room, u=gone)
    await user_model.soft_delete(gone, db_session)
    members = await chat_member.find_by_room(room, db_session)
    assert gone not in [m['user_id'] for m in members]


async def test_scrum_board_members_exclude_soft_deleted(db_session):
    owner = await _user(db_session, "dels1", "dels1@t.local")
    gone = await _user(db_session, "dels2", "dels2@t.local")
    bd = await _board(db_session, owner)
    await _ins(db_session, "INSERT INTO scrum_member (board_id, user_id, role) VALUES (:b,:u,'admin')", b=bd, u=owner)
    await _ins(db_session, "INSERT INTO scrum_member (board_id, user_id, role) VALUES (:b,:u,'member')", b=bd, u=gone)
    await user_model.soft_delete(gone, db_session)
    members = await scrum_member.find_by_board(bd, db_session)
    assert gone not in [m['user_id'] for m in members]


# ── 초대 검색 / 담당자 ─────────────────────────────────────────────────────

async def test_branch_search_non_members_excludes_soft_deleted(db_session):
    owner = await _user(db_session, "delsn1", "delsn1@t.local")
    gone = await _user(db_session, "delsn-target", "delsn2@t.local")
    br = await _branch(db_session, owner, "DLSN")
    await user_model.soft_delete(gone, db_session)
    found = await branch_member.search_non_members(br, "delsn-target", db_session)
    assert gone not in [u['user_id'] for u in found]


async def test_task_assignees_exclude_soft_deleted(db_session):
    owner = await _user(db_session, "dela1", "dela1@t.local")
    gone = await _user(db_session, "dela2", "dela2@t.local")
    br = await _branch(db_session, owner, "DLA")
    task = await _task(db_session, br, owner)
    await _ins(db_session, "INSERT INTO task_assignee (task_id, user_id, role) VALUES (:t,:u,'main')", t=task, u=gone)
    await user_model.soft_delete(gone, db_session)
    detail = await task_model.find_by_id(task, db_session)
    assert gone not in [a['user_id'] for a in detail['assignees']]


async def test_canvas_search_non_members_excludes_soft_deleted(db_session):
    owner = await _user(db_session, "csn1", "csn1@t.local")
    gone = await _user(db_session, "csn-target", "csn2@t.local")
    br = await _branch(db_session, owner, "CSN")
    cv = await _canvas(db_session, br, owner, "CSNC")
    await user_model.soft_delete(gone, db_session)
    found = await canvas_member.search_non_members(cv, "csn-target", db_session)
    assert gone not in [u['user_id'] for u in found]


async def test_track_search_non_members_excludes_soft_deleted(db_session):
    owner = await _user(db_session, "tsn1", "tsn1@t.local")
    gone = await _user(db_session, "tsn-target", "tsn2@t.local")
    tr = await _track(db_session, owner)
    await user_model.soft_delete(gone, db_session)
    found = await track_member.search_non_members(tr, "tsn-target", db_session)
    assert gone not in [u['user_id'] for u in found]


async def test_scrum_search_non_members_excludes_soft_deleted(db_session):
    owner = await _user(db_session, "ssn1", "ssn1@t.local")
    gone = await _user(db_session, "ssn-target", "ssn2@t.local")
    bd = await _board(db_session, owner)
    await user_model.soft_delete(gone, db_session)
    found = await scrum_member.search_non_members(bd, "ssn-target", db_session)
    assert gone not in [u['user_id'] for u in found]


async def test_schedule_participants_exclude_soft_deleted(db_session):
    from core.model import schedule_event as se_model
    owner = await _user(db_session, "dele1", "dele1@t.local")
    gone = await _user(db_session, "dele2", "dele2@t.local")
    br = await _branch(db_session, owner, "DLE")
    row = await db_session.execute(text("""
        INSERT INTO schedule_event (branch_id, title, description, start_date, end_date, color, created_by)
        VALUES (:b, 'E', '', '2026-06-12', '2026-06-12', '#5E6AD2', :u) RETURNING schedule_event_id
    """), {"b": br, "u": owner})
    eid = row.scalar_one()
    await _ins(db_session, "INSERT INTO schedule_event_participant (schedule_event_id, user_id) VALUES (:e,:u)", e=eid, u=gone)
    await user_model.soft_delete(gone, db_session)
    parts = await se_model.find_participants(eid, db_session)
    assert gone not in [p['user_id'] for p in parts]
