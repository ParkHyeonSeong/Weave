"""Subtask embedding in list/board + find_subtasks labels/progress.

Style: direct controller/model calls, rollback-isolated db_session fixture,
seeding through branch_ctrl.create so workflow_status categories
(todo/in_progress/done/cancelled) and task_type 'task' are really seeded.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import branch as branch_ctrl
from core.controller import task as task_ctrl
from core.model import task as task_model
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


async def _make_label(db, branch_id, name="bug"):
    row = await db.execute(text("""
        INSERT INTO label (branch_id, label_name, color)
        VALUES (:b, :n, '#DC2626') RETURNING label_id
    """), {"b": branch_id, "n": name})
    return row.scalar_one()


async def _create_task(db, branch_id, user_id, title, status='todo',
                       parent_task_id=None, label_ids=None):
    res = await task_ctrl.create(
        task_schema.TaskCreate(title=title, status=status,
                               parent_task_id=parent_task_id,
                               label_ids=label_ids),
        branch_id, _req(user_id), db)
    return res["task_id"]


async def test_list_embeds_subtasks_with_labels_and_progress(db_session):
    alice = await _make_user(db_session, "a_emb@sub.test", "a_emb")
    branch = await _make_branch(db_session, alice, "SEMB")
    label_id = await _make_label(db_session, branch, "frontend")

    parent = await _create_task(db_session, branch, alice, "Parent")
    sub_done = await _create_task(db_session, branch, alice, "S-done",
                                  status='done', parent_task_id=parent)
    sub_todo = await _create_task(db_session, branch, alice, "S-todo",
                                  status='todo', parent_task_id=parent,
                                  label_ids=[label_id])
    sub_cancel = await _create_task(db_session, branch, alice, "S-cancel",
                                    status='cancelled', parent_task_id=parent)

    res = await task_ctrl.get_list(branch, None, _req(alice), db_session)
    assert res["status"] is True

    # parent is a top-level row; subtasks are NOT top-level rows
    top_ids = [t["task_id"] for t in res["tasks"]]
    assert parent in top_ids
    assert sub_done not in top_ids and sub_todo not in top_ids and sub_cancel not in top_ids

    prow = next(t for t in res["tasks"] if t["task_id"] == parent)
    # progress: cancelled excluded from both done and total
    assert prow["subtask_progress"] == {"done": 1, "total": 2}

    sub_ids = {s["task_id"] for s in prow["subtasks"]}
    assert sub_ids == {sub_done, sub_todo, sub_cancel}

    s = next(x for x in prow["subtasks"] if x["task_id"] == sub_todo)
    # exact <subtask row> shape from the shared contract
    for k in ("task_id", "branch_id", "parent_task_id", "display_id",
              "display_number", "title", "status", "priority",
              "assignees", "labels"):
        assert k in s, f"missing {k}"
    assert s["parent_task_id"] == parent
    assert s["branch_id"] == branch
    assert [l["label_name"] for l in s["labels"]] == ["frontend"]


async def test_list_parent_without_subtasks_empty(db_session):
    alice = await _make_user(db_session, "a_none@sub.test", "a_none")
    branch = await _make_branch(db_session, alice, "SNONE")
    parent = await _create_task(db_session, branch, alice, "Lonely")

    res = await task_ctrl.get_list(branch, None, _req(alice), db_session)
    prow = next(t for t in res["tasks"] if t["task_id"] == parent)
    assert prow["subtasks"] == []
    assert prow["subtask_progress"] == {"done": 0, "total": 0}


async def _make_sprint(db, branch_id, user_id, name="Sprint 1"):
    """Active sprint 생성 (board 쿼리가 active sprint 태스크만 반환하므로 필요)."""
    row = await db.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, status, created_by)
        VALUES (:b, :n, 'active', :u) RETURNING sprint_id
    """), {"b": branch_id, "n": name, "u": user_id})
    return row.scalar_one()


async def test_board_embeds_subtasks_and_progress(db_session):
    alice = await _make_user(db_session, "a_brd@sub.test", "a_brd")
    branch = await _make_branch(db_session, alice, "SBRD")
    sprint = await _make_sprint(db_session, branch, alice)
    # task_ctrl.create 는 sprint_id 미지원 → 직접 업데이트
    parent = await _create_task(db_session, branch, alice, "P", status='in_progress')
    await db_session.execute(text(
        "UPDATE task SET sprint_id = :s WHERE task_id = :t"
    ), {"s": sprint, "t": parent})
    await _create_task(db_session, branch, alice, "s1", status='done', parent_task_id=parent)
    await _create_task(db_session, branch, alice, "s2", status='in_progress', parent_task_id=parent)

    res = await task_ctrl.get_board(branch, None, _req(alice), db_session)
    assert res["status"] is True
    card = next(t for col in res["columns"].values() for t in col if t["task_id"] == parent)
    assert card["subtask_progress"] == {"done": 1, "total": 2}
    assert len(card["subtasks"]) == 2


async def test_find_subtasks_includes_labels(db_session):
    alice = await _make_user(db_session, "a_fs@sub.test", "a_fs")
    branch = await _make_branch(db_session, alice, "SFND")
    label_id = await _make_label(db_session, branch, "infra")
    parent = await _create_task(db_session, branch, alice, "P")
    sub = await _create_task(db_session, branch, alice, "S",
                             parent_task_id=parent, label_ids=[label_id])

    subs = await task_model.find_subtasks(parent, db_session)
    assert len(subs) == 1
    row = subs[0]
    assert row["task_id"] == sub
    assert row["parent_task_id"] == parent
    assert row["branch_id"] == branch
    assert [l["label_name"] for l in row["labels"]] == ["infra"]
    assert row["assignees"] == []
