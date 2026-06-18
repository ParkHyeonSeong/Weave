"""TDD: get_detail returns task['parent'] for a subtask, None for a top-level task.

Style matches test_subtask_embedding.py — direct controller calls,
rollback-isolated db_session fixture.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import branch as branch_ctrl
from core.controller import task as task_ctrl
from routers.schema import branch as branch_schema
from routers.schema import task as task_schema


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, user_id, key):
    res = await branch_ctrl.create(
        branch_schema.BranchCreate(branch_name="B", key=key), _req(user_id), db)
    return res["branch_id"]


async def _create_task(db, branch_id, user_id, title, parent_task_id=None):
    res = await task_ctrl.create(
        task_schema.TaskCreate(title=title, parent_task_id=parent_task_id),
        branch_id, _req(user_id), db)
    return res["task_id"]


async def test_get_detail_includes_parent_for_subtask(db_session):
    alice = await _make_user(db_session, "a_par@sub.test", "a_par")
    branch = await _make_branch(db_session, alice, "PAR")

    # 부모 (top-level) 태스크
    parent_id = await _create_task(db_session, branch, alice, "Parent task")

    # 자식 태스크 (parent_task_id 지정)
    child_id = await _create_task(db_session, branch, alice, "Child task",
                                  parent_task_id=parent_id)

    # 자식 상세에 parent 동봉 여부 확인
    dres = await task_ctrl.get_detail(child_id, branch, _req(alice), db_session)
    assert dres["status"] is True
    detail = dres["task"]
    assert detail["parent"] is not None
    assert detail["parent"]["task_id"] == parent_id
    assert detail["parent"]["title"] == "Parent task"
    assert "sprint_name" in detail["parent"]
    assert "epic_name" in detail["parent"]
    assert "display_id" in detail["parent"]

    # top-level 태스크는 parent == None
    pdres = await task_ctrl.get_detail(parent_id, branch, _req(alice), db_session)
    assert pdres["status"] is True
    assert pdres["task"]["parent"] is None
