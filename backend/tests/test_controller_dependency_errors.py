from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task_dependency as ctrl
from core.model import task_dependency as dep_model


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id, "username": "u"}))


def _dep_body(source, target, dep_type="finish_to_start"):
    return SimpleNamespace(source_task_id=source, target_task_id=target, dep_type=dep_type)


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, owner, key):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, '', 'private', '#000000', :o) RETURNING branch_id
    """), {"n": key, "k": key, "o": owner})
    return row.scalar_one()


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by):
    dn = (await db.execute(text(
        "SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b"
    ), {"b": branch_id})).scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, 'T', 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "u": created_by})
    return res.scalar_one()


async def test_non_member_gets_forbidden_category(db_session):
    stranger = await _make_user(db_session, "dep_str@d.test", "dep_str")
    branch = await _make_branch(db_session, stranger, "DEP1")
    # stranger is NOT added as a member
    res = await ctrl.create(_dep_body(1, 2), branch, _req(stranger), db_session)
    assert res["status"] is False
    assert res["code"] == "NOT_BRANCH_MEMBER"
    assert res["message"] == "NOT_BRANCH_MEMBER"   # dual-emit preserved
    assert res["category"] == "forbidden"
    assert res["retryable"] is False


async def test_self_dependency_gets_validation_category(db_session):
    alice = await _make_user(db_session, "dep_self@d.test", "dep_self")
    branch = await _make_branch(db_session, alice, "DEP2")
    await _add_member(db_session, branch, alice)
    res = await ctrl.create(_dep_body(5, 5), branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "SELF_DEPENDENCY"
    assert res["category"] == "validation"


async def test_invalid_dep_type_gets_validation_category(db_session):
    alice = await _make_user(db_session, "dep_type@d.test", "dep_type")
    branch = await _make_branch(db_session, alice, "DEP3")
    await _add_member(db_session, branch, alice)
    res = await ctrl.create(_dep_body(5, 6, dep_type="bogus"), branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "INVALID_DEP_TYPE"
    assert res["category"] == "validation"


async def test_missing_task_gets_not_found_category(db_session):
    alice = await _make_user(db_session, "dep_nf@d.test", "dep_nf")
    branch = await _make_branch(db_session, alice, "DEP4")
    await _add_member(db_session, branch, alice)
    # member + distinct ids + valid dep_type, but neither task exists → TASK_NOT_FOUND
    res = await ctrl.create(_dep_body(999001, 999002), branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "TASK_NOT_FOUND"
    assert res["category"] == "not_found"


async def test_circular_dependency_gets_conflict_category(db_session):
    alice = await _make_user(db_session, "dep_cyc@d.test", "dep_cyc")
    branch = await _make_branch(db_session, alice, "DEP5")
    await _add_member(db_session, branch, alice)
    a = await _make_task(db_session, branch, alice)
    c = await _make_task(db_session, branch, alice)
    # a -> c already exists; creating c -> a (finish_to_start) is circular.
    await dep_model.create(branch, a, c, "finish_to_start", alice, db_session)
    res = await ctrl.create(_dep_body(c, a), branch, _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "CIRCULAR_DEPENDENCY"
    assert res["category"] == "conflict"
