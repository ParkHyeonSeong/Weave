"""LOG-11/12: 활동 로그 보안.

- LOG-11: task/page 활동 조회가 cross-branch/canvas로 새지 않는다(대상이 정말 그 범위 소속인지 검증).
- LOG-12: changes의 description/content 본문(old/new)은 응답에서 제거한다.
"""
import json
from types import SimpleNamespace

import bcrypt
from sqlalchemy import text

from core.controller import activity_log as al_controller
from core.model import activity_log as al_model


def _req(uid):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': uid}))


async def _user(db, username, email):
    pw = bcrypt.hashpw(b"x", bcrypt.gensalt())
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES (:e, :p, :u, 'active', 'member') RETURNING user_id
    """), {"e": email, "p": pw, "u": username})
    return row.scalar_one()


async def _branch(db, creator, key):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES ('B', :k, 'd', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"k": key, "u": creator})
    return row.scalar_one()


async def _bmember(db, branch_id, user_id):
    await db.execute(text(
        "INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, 'member')"
    ), {"b": branch_id, "u": user_id})


async def _task(db, branch_id, creator, dn):
    row = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, 'T', 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "u": creator})
    return row.scalar_one()


async def _canvas(db, branch_id, creator, key):
    row = await db.execute(text("""
        INSERT INTO canvas (branch_id, canvas_name, key, visibility, created_by)
        VALUES (:b, 'C', :k, 'private', :u) RETURNING canvas_id
    """), {"b": branch_id, "k": key, "u": creator})
    return row.scalar_one()


async def _cmember(db, canvas_id, user_id):
    await db.execute(text(
        "INSERT INTO canvas_member (canvas_id, user_id, role) VALUES (:c, :u, 'member')"
    ), {"c": canvas_id, "u": user_id})


async def _page(db, canvas_id, creator):
    row = await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, created_by) VALUES (:c, 'P', :u) RETURNING page_id
    """), {"c": canvas_id, "u": creator})
    return row.scalar_one()


# ── LOG-11: cross-branch task 활동 차단 ────────────────────────────────────

async def test_task_activity_cross_branch_blocked(db_session):
    alice = await _user(db_session, "al_al11", "al11@t.local")
    bob = await _user(db_session, "bo_al11", "bo11@t.local")
    br_a = await _branch(db_session, alice, "ALA")
    br_b = await _branch(db_session, bob, "ALB")
    await _bmember(db_session, br_a, alice)   # alice는 A의 멤버
    await _bmember(db_session, br_b, bob)
    task_b = await _task(db_session, br_b, bob, 1)   # task는 B 소속
    # alice가 자신이 멤버인 A를 사칭해 B의 task 활동을 읽으려는 시도
    res = await al_controller.get_task_activity(task_b, br_a, 20, 0, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "TASK_NOT_FOUND"


async def test_task_activity_same_branch_allowed(db_session):
    alice = await _user(db_session, "al_al12", "al12@t.local")
    br = await _branch(db_session, alice, "ALC")
    await _bmember(db_session, br, alice)
    task = await _task(db_session, br, alice, 1)
    res = await al_controller.get_task_activity(task, br, 20, 0, _req(alice), db_session)
    assert res["status"] is True
    assert isinstance(res["activities"], list)


async def test_canvas_page_activity_cross_canvas_blocked(db_session):
    alice = await _user(db_session, "al_al14", "al14@t.local")
    bob = await _user(db_session, "bo_al14", "bo14@t.local")
    br_a = await _branch(db_session, alice, "ALE")
    br_b = await _branch(db_session, bob, "ALF")
    cv_a = await _canvas(db_session, br_a, alice, "CVA")
    cv_b = await _canvas(db_session, br_b, bob, "CVB")
    await _cmember(db_session, cv_a, alice)   # alice는 canvas A의 멤버만
    await _cmember(db_session, cv_b, bob)
    page_b = await _page(db_session, cv_b, bob)   # page는 canvas B 소속
    # alice가 자신이 멤버인 canvas A를 사칭해 B의 page 활동을 읽으려는 시도
    res = await al_controller.get_canvas_page_activity(cv_a, page_b, 20, 0, _req(alice), db_session)
    assert res["status"] is False
    assert res["message"] == "PAGE_NOT_FOUND"


async def test_canvas_page_activity_same_canvas_allowed(db_session):
    alice = await _user(db_session, "al_al15", "al15@t.local")
    br = await _branch(db_session, alice, "ALG")
    cv = await _canvas(db_session, br, alice, "CVC")
    await _cmember(db_session, cv, alice)
    page = await _page(db_session, cv, alice)
    res = await al_controller.get_canvas_page_activity(cv, page, 20, 0, _req(alice), db_session)
    assert res["status"] is True
    assert isinstance(res["activities"], list)


# ── LOG-12: description 본문(old/new) 응답 제거 ────────────────────────────

async def test_description_change_old_new_stripped(db_session):
    alice = await _user(db_session, "al_al13", "al13@t.local")
    br = await _branch(db_session, alice, "ALD")
    await _bmember(db_session, br, alice)
    task = await _task(db_session, br, alice, 1)
    await al_model.create(
        'task', task, alice, 'update',
        changes=[
            {'field': 'description', 'old': 'SECRET-OLD-BODY', 'new': 'SECRET-NEW-BODY'},
            {'field': 'status', 'old': 'todo', 'new': 'done'},
        ],
        branch_id=br, db=db_session)
    acts = await al_model.find_by_entity('task', task, 20, 0, db_session)
    assert len(acts) == 1
    changes = acts[0]['changes']
    desc = next(c for c in changes if c['field'] == 'description')
    status = next(c for c in changes if c['field'] == 'status')
    # description 본문은 제거되고 변경 플래그만 남는다
    assert 'old' not in desc and 'new' not in desc
    assert desc.get('changed') is True
    # 비민감 필드(status)는 old/new 그대로 유지
    assert status['old'] == 'todo' and status['new'] == 'done'
    # 응답 어디에도 본문이 남지 않아야 한다(raw API 우회 방지)
    dumped = json.dumps(acts, default=str)  # created_at(datetime) 직렬화용
    assert 'SECRET-OLD-BODY' not in dumped
    assert 'SECRET-NEW-BODY' not in dumped
