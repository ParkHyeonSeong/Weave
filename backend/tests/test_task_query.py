import datetime
from sqlalchemy import text
from core.model import task as task_model


async def _user(db):
    return (await db.execute(text("INSERT INTO \"user\" (email,password,username,status) "
        "VALUES ('q@t.test',:p,'q','active') RETURNING user_id"), {"p": b"x"})).scalar_one()


async def _branch(db, uid):
    bid = (await db.execute(text("INSERT INTO branch (branch_name,key,description,visibility,color,created_by) "
        "VALUES ('B','QB','d','private','#5E6AD2',:u) RETURNING branch_id"), {"u": uid})).scalar_one()
    for k, l, c, cat, s in [("todo", "To Do", "#9CA3AF", "todo", 0), ("done", "Done", "#16A34A", "done", 2)]:
        await db.execute(text("INSERT INTO workflow_status (branch_id,key,label,color,category,sort_order) "
            "VALUES (:b,:k,:l,:c,:cat,:s)"), {"b": bid, "k": k, "l": l, "c": c, "cat": cat, "s": s})
    await db.execute(text("INSERT INTO branch_member (branch_id,user_id,role) VALUES (:b,:u,'admin')"),
                     {"b": bid, "u": uid})
    return bid


async def _task(db, bid, uid, priority="medium", status="todo", title="t"):
    dn = (await db.execute(text("SELECT COALESCE(MAX(display_number),0)+1 FROM task WHERE branch_id=:b"),
                           {"b": bid})).scalar_one()
    return (await db.execute(text("INSERT INTO task (branch_id,display_number,title,status,priority,created_by) "
        "VALUES (:b,:dn,:t,:s,:p,:u) RETURNING task_id"),
        {"b": bid, "dn": dn, "t": title, "s": status, "p": priority, "u": uid})).scalar_one()


CTX = lambda uid: {"user_id": uid, "today": datetime.date(2026, 6, 22)}


def _f(field, op, v):
    return {"type": "group", "op": "AND", "negate": False,
            "children": [{"type": "cond", "field": field, "op": op, "value": v, "negate": False}]}


async def test_query_filters_priority(db_session):
    uid = await _user(db_session); bid = await _branch(db_session, uid)
    await _task(db_session, bid, uid, priority="high", title="H")
    await _task(db_session, bid, uid, priority="low", title="L")
    res = await task_model.query([bid], _f("priority", "eq", "high"), [], None, 50, 0, CTX(uid), db_session)
    assert res["total"] == 1
    assert [t["title"] for t in res["items"]] == ["H"]
    assert "labels" in res["items"][0] and "assignees" in res["items"][0]


async def test_query_total_independent_of_page(db_session):
    uid = await _user(db_session); bid = await _branch(db_session, uid)
    for i in range(5):
        await _task(db_session, bid, uid, title=f"t{i}")
    res = await task_model.query([bid], None, [], None, 2, 0, CTX(uid), db_session)
    assert res["total"] == 5 and len(res["items"]) == 2


async def test_query_groups_over_full_set(db_session):
    uid = await _user(db_session); bid = await _branch(db_session, uid)
    await _task(db_session, bid, uid, status="todo")
    await _task(db_session, bid, uid, status="todo")
    await _task(db_session, bid, uid, status="done")
    res = await task_model.query([bid], None, [], "status", 1, 0, CTX(uid), db_session)
    counts = {g["key"]: g["count"] for g in res["groups"]}
    assert counts == {"todo": 2, "done": 1}


async def test_search_for_chat_respects_limit(db_session):
    uid = await _user(db_session); bid = await _branch(db_session, uid)
    for i in range(6):
        await _task(db_session, bid, uid, title=f"loginbug{i}")
    rows = await task_model.search_for_chat(uid, "loginbug", False, db_session, limit=3)
    assert len(rows) <= 3
