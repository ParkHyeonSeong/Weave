from types import SimpleNamespace
from sqlalchemy import text
from core.controller import saved_view as ctrl
from routers.schema.saved_view import SavedViewCreate, SavedViewUpdate

def _req(uid): return SimpleNamespace(state=SimpleNamespace(payload={'user_id': uid}))
async def _user(db, e, u):
    r = await db.execute(text('INSERT INTO "user" (email,password,username,status) VALUES (:e,:p,:u,\'active\') RETURNING user_id'), {'e': e, 'p': b'x', 'u': u}); return r.scalar_one()
async def _branch(db, uid, key, member=None):
    r = await db.execute(text("INSERT INTO branch (branch_name,key,description,visibility,color,created_by) VALUES ('b',:k,'d','private','#5E6AD2',:u) RETURNING branch_id"), {'k': key, 'u': uid})
    bid = r.scalar_one()
    await db.execute(text("INSERT INTO branch_member (branch_id,user_id,role) VALUES (:b,:u,'admin')"), {'b': bid, 'u': uid})
    if member: await db.execute(text("INSERT INTO branch_member (branch_id,user_id,role) VALUES (:b,:u,'member')"), {'b': bid, 'u': member})
    return bid

_SPEC = {'type': 'group', 'op': 'AND', 'negate': False, 'children': []}

async def test_create_requires_membership(db_session):
    alice = await _user(db_session, 'a@sv.test', 'a'); bob = await _user(db_session, 'b@sv.test', 'b')
    bid = await _branch(db_session, alice, 'SVM')  # bob 비멤버
    res = await ctrl.create(SavedViewCreate(name='x', scope_branch_id=bid, filter_spec=_SPEC), _req(bob), db_session)
    assert res['status'] is False and res['message'] == 'NOT_BRANCH_MEMBER'

async def test_create_list_owner(db_session):
    uid = await _user(db_session, 'o@sv.test', 'o'); bid = await _branch(db_session, uid, 'SVO')
    c = await ctrl.create(SavedViewCreate(name='V1', scope_branch_id=bid, filter_spec=_SPEC, group_by='status'), _req(uid), db_session)
    assert c['status'] is True
    lst = await ctrl.get_list(bid, _req(uid), db_session)
    assert lst['status'] is True and any(v['view_id'] == c['view_id'] for v in lst['views'])

async def test_update_delete_owner_only(db_session):
    owner = await _user(db_session, 'ow@sv.test', 'ow'); intruder = await _user(db_session, 'in@sv.test', 'in')
    bid = await _branch(db_session, owner, 'SVU', member=intruder)
    vid = (await ctrl.create(SavedViewCreate(name='V', scope_branch_id=bid, filter_spec=_SPEC, visibility='shared'), _req(owner), db_session))['view_id']
    # intruder는 멤버라 shared 뷰 조회는 되지만 수정/삭제 불가
    assert (await ctrl.get_detail(vid, _req(intruder), db_session))['status'] is True
    bad = await ctrl.update(vid, SavedViewUpdate(name='hax'), _req(intruder), db_session)
    assert bad['status'] is False and bad['message'] == 'NOT_VIEW_OWNER'
    bad2 = await ctrl.delete(vid, _req(intruder), db_session)
    assert bad2['status'] is False and bad2['message'] == 'NOT_VIEW_OWNER'
    assert (await ctrl.update(vid, SavedViewUpdate(name='ok'), _req(owner), db_session))['status'] is True

async def test_private_view_not_visible_to_other(db_session):
    owner = await _user(db_session, 'p@sv.test', 'p'); other = await _user(db_session, 'q@sv.test', 'q')
    bid = await _branch(db_session, owner, 'SVP', member=other)
    vid = (await ctrl.create(SavedViewCreate(name='priv', scope_branch_id=bid, filter_spec=_SPEC, visibility='private'), _req(owner), db_session))['view_id']
    res = await ctrl.get_detail(vid, _req(other), db_session)
    assert res['status'] is False and res['message'] == 'NOT_VIEW_VISIBLE'

async def test_removed_member_owner_loses_access(db_session):
    owner = await _user(db_session, 'rm@sv.test', 'rm')
    bid = await _branch(db_session, owner, 'SVRM')
    vid = (await ctrl.create(SavedViewCreate(name='V', scope_branch_id=bid, filter_spec=_SPEC, visibility='shared'), _req(owner), db_session))['view_id']
    await db_session.execute(text("DELETE FROM branch_member WHERE branch_id=:b AND user_id=:u"), {'b': bid, 'u': owner})  # 브랜치에서 제거
    assert (await ctrl.get_detail(vid, _req(owner), db_session))['message'] == 'NOT_VIEW_VISIBLE'
    assert (await ctrl.update(vid, SavedViewUpdate(name='x'), _req(owner), db_session))['message'] == 'NOT_BRANCH_MEMBER'
    assert (await ctrl.delete(vid, _req(owner), db_session))['message'] == 'NOT_BRANCH_MEMBER'

async def test_create_rejects_invalid_spec_and_visibility(db_session):
    uid = await _user(db_session, 'iv@sv.test', 'iv'); bid = await _branch(db_session, uid, 'SVIV')
    bad = {'type': 'group', 'op': 'AND', 'negate': False, 'children': [{'type': 'cond', 'field': 'nonsense', 'op': 'eq', 'value': 1, 'negate': False}]}
    r1 = await ctrl.create(SavedViewCreate(name='bad', scope_branch_id=bid, filter_spec=bad), _req(uid), db_session)
    assert r1['status'] is False and r1['message'] == 'INVALID_FILTER'
    r2 = await ctrl.create(SavedViewCreate(name='badvis', scope_branch_id=bid, filter_spec=_SPEC, visibility='public'), _req(uid), db_session)
    assert r2['status'] is False and r2['message'] == 'INVALID_VISIBILITY'

async def test_update_rejects_invalid_visibility(db_session):
    uid = await _user(db_session, 'uv@sv.test', 'uv'); bid = await _branch(db_session, uid, 'SVUV')
    vid = (await ctrl.create(SavedViewCreate(name='V', scope_branch_id=bid, filter_spec=_SPEC), _req(uid), db_session))['view_id']
    res = await ctrl.update(vid, SavedViewUpdate(visibility='public'), _req(uid), db_session)
    assert res['status'] is False and res['message'] == 'INVALID_VISIBILITY'

async def test_cond_root_spec_preserved(db_session):
    # cond 루트 spec은 빈 그룹으로 정규화되지 않고 보존돼야 한다(조용한 '전체보기' 방지)
    uid = await _user(db_session, 'cr@sv.test', 'cr'); bid = await _branch(db_session, uid, 'SVCR')
    cond = {'type': 'cond', 'field': 'priority', 'op': 'eq', 'value': 'high', 'negate': False}
    vid = (await ctrl.create(SavedViewCreate(name='hi', scope_branch_id=bid, filter_spec=cond), _req(uid), db_session))['view_id']
    got = await ctrl.get_detail(vid, _req(uid), db_session)
    assert got['view']['filter_spec'] == cond  # 빈 그룹으로 안 바뀜

async def test_update_clears_group_by_with_explicit_null(db_session):
    # group_by=None(그룹핑 해제) 업데이트가 살아야 한다(exclude_unset — 리뷰 P1). name 등은 보존.
    uid = await _user(db_session, 'gc@sv.test', 'gc'); bid = await _branch(db_session, uid, 'SVGC')
    vid = (await ctrl.create(SavedViewCreate(name='grouped', scope_branch_id=bid, filter_spec=_SPEC, group_by='status'), _req(uid), db_session))['view_id']
    assert (await ctrl.get_detail(vid, _req(uid), db_session))['view']['group_by'] == 'status'
    res = await ctrl.update(vid, SavedViewUpdate(filter_spec=_SPEC, group_by=None, sort=[]), _req(uid), db_session)
    assert res['status'] is True
    got = (await ctrl.get_detail(vid, _req(uid), db_session))['view']
    assert got['group_by'] is None   # 그룹핑 해제됨
    assert got['name'] == 'grouped'  # 안 보낸 필드는 보존

async def test_create_rejects_invalid_scope(db_session):
    uid = await _user(db_session, 'is@sv.test', 'is')
    res = await ctrl.create(SavedViewCreate(name='bad', scope_branch_id=None, filter_spec=_SPEC, scope='bogus'), _req(uid), db_session)
    assert res['status'] is False and res['message'] == 'INVALID_SCOPE'

async def test_personal_view_scope_roundtrip(db_session):
    # 개인 뷰의 scope가 저장·조회·수정으로 라운드트립
    uid = await _user(db_session, 'rs@sv.test', 'rs')
    vid = (await ctrl.create(SavedViewCreate(name='allv', scope_branch_id=None, filter_spec=_SPEC, scope='all'), _req(uid), db_session))['view_id']
    assert (await ctrl.get_detail(vid, _req(uid), db_session))['view']['scope'] == 'all'
    await ctrl.update(vid, SavedViewUpdate(scope='my'), _req(uid), db_session)
    assert (await ctrl.get_detail(vid, _req(uid), db_session))['view']['scope'] == 'my'

async def test_branch_view_rejects_scope(db_session):
    # 브랜치 뷰에는 scope 설정 불가(create·update 모두) — 계약 위반 데이터 차단(리뷰 P2)
    uid = await _user(db_session, 'bs@sv.test', 'bs'); bid = await _branch(db_session, uid, 'SVBS')
    r = await ctrl.create(SavedViewCreate(name='bad', scope_branch_id=bid, filter_spec=_SPEC, scope='all'), _req(uid), db_session)
    assert r['status'] is False and r['message'] == 'VIEW_SCOPE_MISMATCH'
    # 정상 브랜치 뷰 생성 후 scope 수정 시도도 거부
    vid = (await ctrl.create(SavedViewCreate(name='ok', scope_branch_id=bid, filter_spec=_SPEC), _req(uid), db_session))['view_id']
    r2 = await ctrl.update(vid, SavedViewUpdate(scope='all'), _req(uid), db_session)
    assert r2['status'] is False and r2['message'] == 'VIEW_SCOPE_MISMATCH'
