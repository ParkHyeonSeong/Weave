import json
from sqlalchemy import text
from core.model import saved_view as sv


async def _user(db, email='v@t.test', name='v'):
    r = await db.execute(text('INSERT INTO "user" (email, password, username, status) VALUES (:e,:p,:u,\'active\') RETURNING user_id'), {'e': email, 'p': b'x', 'u': name})
    return r.scalar_one()


async def _branch(db, uid, key='SV'):
    r = await db.execute(text("INSERT INTO branch (branch_name, key, description, visibility, color, created_by) VALUES ('b',:k,'d','private','#5E6AD2',:u) RETURNING branch_id"), {'k': key, 'u': uid})
    bid = r.scalar_one()
    await db.execute(text("INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b,:u,'admin')"), {'b': bid, 'u': uid})
    return bid


async def test_create_and_find(db_session):
    uid = await _user(db_session); bid = await _branch(db_session, uid)
    spec = {'type': 'group', 'op': 'AND', 'negate': False, 'children': [{'type': 'cond', 'field': 'priority', 'op': 'eq', 'value': 'high', 'negate': False}]}
    vid = await sv.create(uid, bid, 'High prio', spec, 'status', [{'field': 'due_date', 'dir': 'asc'}], None, 'private', db_session)
    assert vid > 0
    got = await sv.find_by_id(vid, db_session)
    assert got['name'] == 'High prio' and got['owner_user_id'] == uid and got['scope_branch_id'] == bid
    assert got['filter_spec']['op'] == 'AND' and got['group_by'] == 'status'
    assert got['sort'][0]['field'] == 'due_date'


async def test_find_accessible_owner_and_shared(db_session):
    owner = await _user(db_session, 'o@t.test', 'o'); other = await _user(db_session, 'x@t.test', 'x')
    bid = await _branch(db_session, owner, 'ACC')
    await db_session.execute(text("INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b,:u,'member')"), {'b': bid, 'u': other})
    g = {'type': 'group', 'op': 'AND', 'negate': False, 'children': []}
    v_priv = await sv.create(owner, bid, 'mine-private', g, None, None, None, 'private', db_session)
    v_shared = await sv.create(owner, bid, 'shared', g, None, None, None, 'shared', db_session)
    # other: shared만 보임(private 소유 아님)
    other_views = {v['view_id'] for v in await sv.find_accessible(other, bid, db_session)}
    assert v_shared in other_views and v_priv not in other_views
    # owner: 둘 다
    owner_views = {v['view_id'] for v in await sv.find_accessible(owner, bid, db_session)}
    assert v_shared in owner_views and v_priv in owner_views


async def test_find_accessible_removed_owner_gets_nothing(db_session):
    # Global 계약: 브랜치 뷰는 owner여도 현재 멤버가 아니면 안 보인다(모델 자기완결).
    owner = await _user(db_session, 'ro@t.test', 'ro')
    bid = await _branch(db_session, owner, 'RMV')
    g = {'type': 'group', 'op': 'AND', 'negate': False, 'children': []}
    vid = await sv.create(owner, bid, 'owned', g, None, None, None, 'private', db_session)
    assert vid in {v['view_id'] for v in await sv.find_accessible(owner, bid, db_session)}  # 멤버일 땐 보임
    await db_session.execute(text("DELETE FROM branch_member WHERE branch_id=:b AND user_id=:u"), {'b': bid, 'u': owner})
    assert vid not in {v['view_id'] for v in await sv.find_accessible(owner, bid, db_session)}  # 제거 후 회수
