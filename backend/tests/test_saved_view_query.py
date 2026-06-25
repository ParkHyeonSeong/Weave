from types import SimpleNamespace
from sqlalchemy import text
from core.controller import task as task_ctrl
from core.controller import saved_view as sv_ctrl
from routers.schema.saved_view import SavedViewCreate


def _req(uid): return SimpleNamespace(state=SimpleNamespace(payload={"user_id": uid}))


async def _user(db, e, u):
    return (await db.execute(text("INSERT INTO \"user\" (email,password,username,status) "
        "VALUES (:e,:p,:u,'active') RETURNING user_id"), {"e": e, "p": b"x", "u": u})).scalar_one()


async def _branch(db, uid, key):
    bid = (await db.execute(text("INSERT INTO branch (branch_name,key,description,visibility,color,created_by) "
        "VALUES ('B',:k,'d','private','#5E6AD2',:u) RETURNING branch_id"), {"k": key, "u": uid})).scalar_one()
    await db.execute(text("INSERT INTO branch_member (branch_id,user_id,role) VALUES (:b,:u,'admin')"),
                     {"b": bid, "u": uid})
    return bid


async def _member(db, bid, uid):
    await db.execute(text("INSERT INTO branch_member (branch_id,user_id,role) VALUES (:b,:u,'member')"),
                     {"b": bid, "u": uid})


async def _task(db, bid, uid, priority="high"):
    dn = (await db.execute(text("SELECT COALESCE(MAX(display_number),0)+1 FROM task WHERE branch_id=:b"),
                           {"b": bid})).scalar_one()
    return (await db.execute(text("INSERT INTO task (branch_id,display_number,title,status,priority,created_by) "
        "VALUES (:b,:dn,'t','todo',:p,:u) RETURNING task_id"), {"b": bid, "dn": dn, "p": priority, "u": uid})).scalar_one()


def _q(**kw):
    d = {'filter': None, 'sort': [], 'group_by': None, 'page': 1, 'page_size': 50,
         'limit': None, 'offset': None, 'saved_view_id': None, 'scope': 'my'}
    d.update(kw)
    return SimpleNamespace(**d)


_HIGH = {'type': 'group', 'op': 'AND', 'negate': False,
         'children': [{'type': 'cond', 'field': 'priority', 'op': 'eq', 'value': 'high', 'negate': False}]}
_EMPTY = {'type': 'group', 'op': 'AND', 'negate': False, 'children': []}


async def test_branch_query_applies_view_spec(db_session):
    uid = await _user(db_session, 'q@sv.test', 'q'); bid = await _branch(db_session, uid, 'SVQ')
    await _task(db_session, bid, uid, priority='high'); await _task(db_session, bid, uid, priority='low')
    vid = (await sv_ctrl.create(SavedViewCreate(name='hi', scope_branch_id=bid, filter_spec=_HIGH), _req(uid), db_session))['view_id']
    res = await task_ctrl.query_branch(bid, _q(saved_view_id=vid), _req(uid), db_session)
    assert res['status'] is True
    assert all(it['priority'] == 'high' for it in res['items']) and res['total'] == 1


async def test_branch_query_cond_root_view_applies(db_session):
    # cond 루트 뷰도 그대로 적용돼야(빈 그룹='전체보기'로 안 날아감)
    uid = await _user(db_session, 'cr@svq.test', 'cr'); bid = await _branch(db_session, uid, 'SVCRQ')
    await _task(db_session, bid, uid, priority='high'); await _task(db_session, bid, uid, priority='low')
    cond = {'type': 'cond', 'field': 'priority', 'op': 'eq', 'value': 'high', 'negate': False}
    vid = (await sv_ctrl.create(SavedViewCreate(name='c', scope_branch_id=bid, filter_spec=cond), _req(uid), db_session))['view_id']
    res = await task_ctrl.query_branch(bid, _q(saved_view_id=vid), _req(uid), db_session)
    assert res['status'] is True and res['total'] == 1


async def test_branch_query_personal_view_rejected(db_session):
    uid = await _user(db_session, 'pv@sv.test', 'pv'); bid = await _branch(db_session, uid, 'SVPV')
    vid = (await sv_ctrl.create(SavedViewCreate(name='personal', scope_branch_id=None, filter_spec=_EMPTY), _req(uid), db_session))['view_id']
    res = await task_ctrl.query_branch(bid, _q(saved_view_id=vid), _req(uid), db_session)
    assert res['status'] is False and res['message'] == 'VIEW_SCOPE_MISMATCH'


async def test_branch_query_view_not_found(db_session):
    uid = await _user(db_session, 'nf@sv.test', 'nf'); bid = await _branch(db_session, uid, 'SVNF')
    res = await task_ctrl.query_branch(bid, _q(saved_view_id=999999), _req(uid), db_session)
    assert res['status'] is False and res['message'] == 'VIEW_NOT_FOUND'


async def test_branch_query_private_view_of_other_rejected(db_session):
    # 같은 브랜치 멤버라도 남의 private 뷰는 NOT_VIEW_VISIBLE
    owner = await _user(db_session, 'o@svq.test', 'o'); bid = await _branch(db_session, owner, 'SVOTH')
    other = await _user(db_session, 'x@svq.test', 'x'); await _member(db_session, bid, other)
    vid = (await sv_ctrl.create(SavedViewCreate(name='priv', scope_branch_id=bid, filter_spec=_EMPTY, visibility='private'), _req(owner), db_session))['view_id']
    res = await task_ctrl.query_branch(bid, _q(saved_view_id=vid), _req(other), db_session)
    assert res['status'] is False and res['message'] == 'NOT_VIEW_VISIBLE'


async def test_cross_query_applies_personal_view(db_session):
    uid = await _user(db_session, 'cx@sv.test', 'cx'); bid = await _branch(db_session, uid, 'SVCX')
    await _task(db_session, bid, uid, priority='high'); await _task(db_session, bid, uid, priority='low')
    vid = (await sv_ctrl.create(SavedViewCreate(name='myhi', scope_branch_id=None, filter_spec=_HIGH), _req(uid), db_session))['view_id']
    res = await task_ctrl.query_cross_branch(_q(saved_view_id=vid, scope='all'), _req(uid), db_session)
    assert res['status'] is True and res['total'] == 1


async def test_cross_query_branch_view_rejected(db_session):
    uid = await _user(db_session, 'cb@sv.test', 'cb'); bid = await _branch(db_session, uid, 'SVCB')
    vid = (await sv_ctrl.create(SavedViewCreate(name='br', scope_branch_id=bid, filter_spec=_EMPTY), _req(uid), db_session))['view_id']
    res = await task_ctrl.query_cross_branch(_q(saved_view_id=vid, scope='all'), _req(uid), db_session)
    assert res['status'] is False and res['message'] == 'VIEW_SCOPE_MISMATCH'


async def test_cross_query_honors_view_scope(db_session):
    # 개인 뷰 scope='all'을 saved_view_id로 적용하면 body.scope='my'여도 전체(남의 태스크 포함)가 나와야.
    owner = await _user(db_session, 'vsc@sv.test', 'vsc'); bid = await _branch(db_session, owner, 'VSC')
    other = await _user(db_session, 'vso@sv.test', 'vso'); await _member(db_session, bid, other)
    t_mine = await _task(db_session, bid, owner, priority='high')
    # 남의 태스크(다른 사람에게 배정)
    t_other = await _task(db_session, bid, owner, priority='high')
    await db_session.execute(text("INSERT INTO task_assignee (task_id,user_id,role) VALUES (:t,:u,'main')"), {'t': t_other, 'u': other})
    vid = (await sv_ctrl.create(SavedViewCreate(name='allv', scope_branch_id=None, filter_spec=_EMPTY, scope='all'), _req(owner), db_session))['view_id']
    res = await task_ctrl.query_cross_branch(_q(saved_view_id=vid, scope='my'), _req(owner), db_session)
    ids = {it['task_id'] for it in res['items']}
    assert t_other in ids  # 뷰 scope='all'이 body 'my'를 덮어 남의 태스크도 포함
