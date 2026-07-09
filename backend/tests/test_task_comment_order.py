"""task 댓글 order 파라미터(asc/desc + comment_id tiebreak) 테스트.

NOTE: 한 트랜잭션 안에서 now()는 동일하므로, 방향 테스트는 created_at을
명시한 직접 INSERT로 만들고, tiebreak 테스트는 동일 timestamp를 활용한다.
"""
from types import SimpleNamespace
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from core.controller import task_comment as comment_ctrl
from core.model import task_comment as comment_model


def _req(user_id, username="u"):
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id, "username": username}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Branch", key="KEY"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    return row.scalar_one()


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by, title="Task"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "u": created_by})
    return res.scalar_one()


async def _insert_comment(db, task_id, author_id, content, created_at, parent_id=None):
    """created_at을 명시해 직접 INSERT (트랜잭션 내 now() 동일 문제 우회)."""
    row = await db.execute(text("""
        INSERT INTO task_comment (task_id, parent_comment_id, author_id, content, created_at)
        VALUES (:t, :p, :a, :c, :ts) RETURNING comment_id
    """), {"t": task_id, "p": parent_id, "a": author_id, "c": content, "ts": created_at})
    return row.scalar_one()


async def _seed(db, key):
    """유저 1 + 브랜치 + 태스크. 반환: (user, branch, task)"""
    user = await _make_user(db, f"{key}@t.t", key)
    branch = await _make_branch(db, user, name=key, key=key)
    await _add_member(db, branch, user)
    task = await _make_task(db, branch, user)
    return user, branch, task


async def test_find_by_task_default_asc(db_session):
    user, _, task = await _seed(db_session, "ORD_A")
    old = await _insert_comment(db_session, task, user, "old", datetime(2026, 7, 1, 10, 0, 0, tzinfo=timezone.utc))
    new = await _insert_comment(db_session, task, user, "new", datetime(2026, 7, 2, 10, 0, 0, tzinfo=timezone.utc))
    rows = await comment_model.find_by_task(task, db_session)
    assert [r["comment_id"] for r in rows] == [old, new]


async def test_find_by_task_desc(db_session):
    user, _, task = await _seed(db_session, "ORD_B")
    old = await _insert_comment(db_session, task, user, "old", datetime(2026, 7, 1, 10, 0, 0, tzinfo=timezone.utc))
    new = await _insert_comment(db_session, task, user, "new", datetime(2026, 7, 2, 10, 0, 0, tzinfo=timezone.utc))
    rows = await comment_model.find_by_task(task, db_session, order="desc")
    assert [r["comment_id"] for r in rows] == [new, old]


async def test_same_timestamp_tiebreak_comment_id(db_session):
    user, _, task = await _seed(db_session, "ORD_C")
    ts = datetime(2026, 7, 1, 10, 0, 0, tzinfo=timezone.utc)
    c1 = await _insert_comment(db_session, task, user, "c1", ts)
    c2 = await _insert_comment(db_session, task, user, "c2", ts)
    asc = await comment_model.find_by_task(task, db_session, order="asc")
    desc = await comment_model.find_by_task(task, db_session, order="desc")
    assert [r["comment_id"] for r in asc] == [c1, c2]
    assert [r["comment_id"] for r in desc] == [c2, c1]


async def test_tombstone_kept_in_desc(db_session):
    """삭제된 root(살아있는 답글 보유)는 desc에서도 tombstone으로 포함된다."""
    user, _, task = await _seed(db_session, "ORD_D")
    root = await _insert_comment(db_session, task, user, "root", datetime(2026, 7, 1, 10, 0, 0, tzinfo=timezone.utc))
    await _insert_comment(db_session, task, user, "reply", datetime(2026, 7, 2, 10, 0, 0, tzinfo=timezone.utc), parent_id=root)
    newer = await _insert_comment(db_session, task, user, "newer", datetime(2026, 7, 3, 10, 0, 0, tzinfo=timezone.utc))
    await db_session.execute(text(
        "UPDATE task_comment SET deleted_at = now() WHERE comment_id = :c"), {"c": root})
    rows = await comment_model.find_by_task(task, db_session, order="desc")
    ids = [r["comment_id"] for r in rows]
    assert root in ids and ids[0] == newer  # tombstone 포함 + 최신 root가 맨 앞


async def test_invalid_order_rejected_by_whitelist(db_session):
    user, _, task = await _seed(db_session, "ORD_E")
    with pytest.raises(KeyError):
        await comment_model.find_by_task(task, db_session, order="1; DROP TABLE task_comment")


async def test_controller_passes_order(db_session):
    user, branch, task = await _seed(db_session, "ORD_F")
    old = await _insert_comment(db_session, task, user, "old", datetime(2026, 7, 1, 10, 0, 0, tzinfo=timezone.utc))
    new = await _insert_comment(db_session, task, user, "new", datetime(2026, 7, 2, 10, 0, 0, tzinfo=timezone.utc))
    res = await comment_ctrl.list_comments(branch, task, _req(user), db_session, order="desc")
    assert res["status"] is True
    assert [c["comment_id"] for c in res["comments"]] == [new, old]
