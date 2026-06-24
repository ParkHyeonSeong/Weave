from types import SimpleNamespace
from sqlalchemy import text
from core.controller import task as ctrl


def _req(uid): return SimpleNamespace(state=SimpleNamespace(payload={"user_id": uid}))


async def _user(db, e="api@t.test", u="api"):
    return (await db.execute(text("INSERT INTO \"user\" (email,password,username,status) "
        "VALUES (:e,:p,:u,'active') RETURNING user_id"), {"e": e, "p": b"x", "u": u})).scalar_one()


async def _branch(db, uid, key="API"):
    bid = (await db.execute(text("INSERT INTO branch (branch_name,key,description,visibility,color,created_by) "
        "VALUES ('B',:k,'d','private','#5E6AD2',:u) RETURNING branch_id"), {"k": key, "u": uid})).scalar_one()
    await db.execute(text("INSERT INTO branch_member (branch_id,user_id,role) VALUES (:b,:u,'admin')"),
                     {"b": bid, "u": uid})
    return bid


async def _task(db, bid, uid, priority="high"):
    dn = (await db.execute(text("SELECT COALESCE(MAX(display_number),0)+1 FROM task WHERE branch_id=:b"),
                           {"b": bid})).scalar_one()
    return (await db.execute(text("INSERT INTO task (branch_id,display_number,title,status,priority,created_by) "
        "VALUES (:b,:dn,'t','todo',:p,:u) RETURNING task_id"), {"b": bid, "dn": dn, "p": priority, "u": uid})).scalar_one()


def _body(**kw):
    return SimpleNamespace(filter=kw.get("filter"), sort=kw.get("sort", []),
                           group_by=kw.get("group_by"), page=kw.get("page", 1),
                           page_size=kw.get("page_size", 50))


async def test_query_branch_filters(db_session):
    uid = await _user(db_session); bid = await _branch(db_session, uid)
    await _task(db_session, bid, uid, priority="high")
    await _task(db_session, bid, uid, priority="low")
    spec = {"type": "group", "op": "AND", "negate": False,
            "children": [{"type": "cond", "field": "priority", "op": "eq", "value": "high", "negate": False}]}
    res = await ctrl.query_branch(bid, _body(filter=spec), _req(uid), db_session)
    assert res["status"] is True and res["total"] == 1


async def test_query_branch_unknown_field(db_session):
    uid = await _user(db_session); bid = await _branch(db_session, uid)
    spec = {"type": "group", "op": "AND", "negate": False,
            "children": [{"type": "cond", "field": "evil", "op": "eq", "value": 1, "negate": False}]}
    res = await ctrl.query_branch(bid, _body(filter=spec), _req(uid), db_session)
    assert res["status"] is False and res["message"] == "INVALID_FILTER"


async def test_query_branch_non_member_blocked(db_session):
    owner = await _user(db_session, "own@t.test", "own")
    intruder = await _user(db_session, "bad@t.test", "bad")
    bid = await _branch(db_session, owner, key="SECR")  # intruder는 비멤버
    res = await ctrl.query_branch(bid, _body(filter=None), _req(intruder), db_session)
    assert res["status"] is False and res["message"] == "NOT_BRANCH_MEMBER"


async def test_query_branch_dict_sort_item(db_session):
    # sort item을 dict로 넘겨도 _dump_sort가 정규화 — 계약 회귀 가드
    uid = await _user(db_session); bid = await _branch(db_session, uid)
    await _task(db_session, bid, uid, priority="low")
    await _task(db_session, bid, uid, priority="urgent")
    body = _body(filter=None, sort=[{"field": "priority", "dir": "asc"}])
    res = await ctrl.query_branch(bid, body, _req(uid), db_session)
    assert res["status"] is True
    assert res["items"][0]["priority"] == "urgent"  # priority asc → urgent 먼저


async def test_query_cross_scope_my_only_member_branches(db_session):
    uid = await _user(db_session, "cx@t.test", "cx")
    mine = await _branch(db_session, uid, key="CXM")              # 멤버
    mine_tid = await _task(db_session, mine, uid, priority="high")
    await db_session.execute(text("INSERT INTO task_assignee (task_id,user_id,role) VALUES (:t,:u,'main')"),
                             {"t": mine_tid, "u": uid})           # 내가 담당(scope=my 포함 대상)
    # 비멤버 branch + 거기 할당된 task
    other_owner = await _user(db_session, "oo@t.test", "oo")
    foreign = await _branch(db_session, other_owner, key="CXO")
    dn = (await db_session.execute(text("SELECT COALESCE(MAX(display_number),0)+1 FROM task WHERE branch_id=:b"),
                                   {"b": foreign})).scalar_one()
    tid = (await db_session.execute(text("INSERT INTO task (branch_id,display_number,title,status,priority,created_by) "
        "VALUES (:b,:dn,'foreign','todo','high',:u) RETURNING task_id"),
        {"b": foreign, "dn": dn, "u": other_owner})).scalar_one()
    await db_session.execute(text("INSERT INTO task_assignee (task_id,user_id,role) VALUES (:t,:u,'main')"),
                             {"t": tid, "u": uid})  # uid가 할당됐지만 비멤버
    body = SimpleNamespace(filter=None, sort=[], group_by=None, page=1, page_size=50, scope="my")
    res = await ctrl.query_cross_branch(body, _req(uid), db_session)
    branch_ids = {it["branch_key"] for it in res["items"]}
    assert "CXM" in branch_ids       # scope=my: 내가 담당한 멤버 브랜치 task는 포함(positive)
    assert "CXO" not in branch_ids   # 비멤버 브랜치는 할당돼 있어도 제외(IDOR)


async def test_query_cross_invalid_scope_rejected(db_session):
    # 오타 scope("mine")는 더 넓은 결과를 주지 않고 INVALID_SCOPE로 거부
    uid = await _user(db_session, "sc@t.test", "sc")
    body = SimpleNamespace(filter=None, sort=[], group_by=None, page=1, page_size=50, scope="mine")
    res = await ctrl.query_cross_branch(body, _req(uid), db_session)
    assert res["status"] is False and res["message"] == "INVALID_SCOPE"


async def test_query_branch_status_sort_uses_workflow_order(db_session):
    # 평면 뷰의 status 정렬이 워크플로 sort_order로 서버 정렬돼야(키 알파벳 아님) — saved_view parity
    uid = await _user(db_session, "ss@t.test", "ss"); bid = await _branch(db_session, uid, "SST")
    for key, so in (("zdone", 0), ("atodo", 1)):  # sort_order가 키 알파벳과 반대
        await db_session.execute(text(
            "INSERT INTO workflow_status (branch_id,key,label,color,category,sort_order,is_default) "
            "VALUES (:b,:k,:k,'#000000','todo',:so,false)"), {"b": bid, "k": key, "so": so})

    async def _t(status):
        dn = (await db_session.execute(text("SELECT COALESCE(MAX(display_number),0)+1 FROM task WHERE branch_id=:b"),
                                       {"b": bid})).scalar_one()
        return (await db_session.execute(text(
            "INSERT INTO task (branch_id,display_number,title,status,priority,created_by) "
            "VALUES (:b,:dn,'t',:s,'medium',:u) RETURNING task_id"),
            {"b": bid, "dn": dn, "s": status, "u": uid})).scalar_one()

    t_z = await _t("zdone")  # sort_order 0
    t_a = await _t("atodo")  # sort_order 1
    res = await ctrl.query_branch(bid, _body(sort=[{"field": "status", "dir": "asc"}]), _req(uid), db_session)
    ids = [it["task_id"] for it in res["items"]]
    assert ids.index(t_z) < ids.index(t_a)  # sort_order 0(zdone) 먼저 — 키 알파벳이면 atodo가 먼저였을 것
