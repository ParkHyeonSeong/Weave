"""task 댓글 답글 알림(comment_reply) 테스트. 컨트롤러 직접호출 + rollback-isolated db_session.

Seed 헬퍼는 test_issue_close_with_comment.py와 동일 패턴.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task_comment as comment_ctrl
from core.model import notification as noti_model


def _req(user_id, username="u"):
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id, "username": username}))


def _body(content, parent_comment_id=None):
    return SimpleNamespace(content=content, parent_comment_id=parent_comment_id)


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


async def _remove_member(db, branch_id, user_id):
    await db.execute(text("""
        DELETE FROM branch_member WHERE branch_id = :b AND user_id = :u
    """), {"b": branch_id, "u": user_id})


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


async def _seed(db, key):
    """alice(root 작성자) + bob(답글 작성자) + 태스크 + alice의 root 댓글. 반환: (alice, bob, branch, task, root_id)"""
    alice = await _make_user(db, f"{key}_a@t.t", f"{key}_a")
    bob = await _make_user(db, f"{key}_b@t.t", f"{key}_b")
    branch = await _make_branch(db, alice, name=key, key=key)
    await _add_member(db, branch, alice)
    await _add_member(db, branch, bob)
    task = await _make_task(db, branch, alice)
    res = await comment_ctrl.create_comment(_body("<p>root</p>"), branch, task, _req(alice, f"{key}_a"), db)
    assert res["status"] is True
    return alice, bob, branch, task, res["comment"]["comment_id"]


def _of_type(notis, ntype):
    return [n for n in notis if n["type"] == ntype]


async def test_reply_notifies_root_author(db_session):
    alice, bob, branch, task, root_id = await _seed(db_session, "CR1")

    res = await comment_ctrl.create_comment(
        _body("<p>reply</p>", parent_comment_id=root_id), branch, task, _req(bob, "CR1_b"), db_session)
    assert res["status"] is True
    reply_id = res["comment"]["comment_id"]

    notis = _of_type(await noti_model.find_by_user(alice, db=db_session), "comment_reply")
    assert len(notis) == 1
    assert notis[0]["entity_type"] == "task_comment"
    assert notis[0]["entity_id"] == reply_id
    assert notis[0]["link"] == f"/branch/{branch}/task/{task}?comment_id={reply_id}"


async def test_reply_with_mention_dedupes_to_mention_only(db_session):
    alice, bob, branch, task, root_id = await _seed(db_session, "CR2")

    content = f'<p><span data-mention="true" data-user-id="{alice}">@a</span> reply</p>'
    res = await comment_ctrl.create_comment(
        _body(content, parent_comment_id=root_id), branch, task, _req(bob, "CR2_b"), db_session)
    assert res["status"] is True

    notis = await noti_model.find_by_user(alice, db=db_session)
    assert len(_of_type(notis, "mention")) == 1
    assert len(_of_type(notis, "comment_reply")) == 0


async def test_self_reply_no_notification(db_session):
    alice, bob, branch, task, root_id = await _seed(db_session, "CR3")

    res = await comment_ctrl.create_comment(
        _body("<p>self reply</p>", parent_comment_id=root_id), branch, task, _req(alice, "CR3_a"), db_session)
    assert res["status"] is True

    notis = await noti_model.find_by_user(alice, db=db_session)
    assert len(_of_type(notis, "comment_reply")) == 0


async def test_root_comment_no_reply_notification(db_session):
    alice, bob, branch, task, root_id = await _seed(db_session, "CR4")

    res = await comment_ctrl.create_comment(
        _body("<p>another root</p>"), branch, task, _req(bob, "CR4_b"), db_session)
    assert res["status"] is True

    notis = await noti_model.find_by_user(alice, db=db_session)
    assert len(_of_type(notis, "comment_reply")) == 0


async def test_depth1_reply_notifies_root_author_only(db_session):
    """carol의 depth-1 답글에 bob이 답글 → normalize되어 root 작성자 alice만 comment_reply."""
    alice, bob, branch, task, root_id = await _seed(db_session, "CR5")
    carol = await _make_user(db_session, "CR5_c@t.t", "CR5_c")
    await _add_member(db_session, branch, carol)

    res = await comment_ctrl.create_comment(
        _body("<p>c reply</p>", parent_comment_id=root_id), branch, task, _req(carol, "CR5_c"), db_session)
    assert res["status"] is True
    carol_reply_id = res["comment"]["comment_id"]

    res = await comment_ctrl.create_comment(
        _body("<p>b reply to c</p>", parent_comment_id=carol_reply_id), branch, task, _req(bob, "CR5_b"), db_session)
    assert res["status"] is True
    bob_reply_id = res["comment"]["comment_id"]

    alice_notis = _of_type(await noti_model.find_by_user(alice, db=db_session), "comment_reply")
    # count뿐 아니라 어느 답글이 알림을 만들었는지까지 고정 (회귀 신호 명확화)
    assert {n["entity_id"] for n in alice_notis} == {carol_reply_id, bob_reply_id}
    bob_noti = next(n for n in alice_notis if n["entity_id"] == bob_reply_id)
    assert bob_noti["link"] == f"/branch/{branch}/task/{task}?comment_id={bob_reply_id}"
    carol_notis = await noti_model.find_by_user(carol, db=db_session)
    assert len(_of_type(carol_notis, "comment_reply")) == 0


async def test_reply_to_ex_member_author_no_notification(db_session):
    alice, bob, branch, task, root_id = await _seed(db_session, "CR6")
    await _remove_member(db_session, branch, alice)

    res = await comment_ctrl.create_comment(
        _body("<p>reply</p>", parent_comment_id=root_id), branch, task, _req(bob, "CR6_b"), db_session)
    assert res["status"] is True

    notis = await noti_model.find_by_user(alice, db=db_session)
    assert len(_of_type(notis, "comment_reply")) == 0


async def test_update_reply_does_not_resend_reply_notification(db_session):
    alice, bob, branch, task, root_id = await _seed(db_session, "CR7")

    res = await comment_ctrl.create_comment(
        _body("<p>reply</p>", parent_comment_id=root_id), branch, task, _req(bob, "CR7_b"), db_session)
    assert res["status"] is True
    reply_id = res["comment"]["comment_id"]

    res = await comment_ctrl.update_comment(
        _body("<p>edited reply</p>"), branch, task, reply_id, _req(bob, "CR7_b"), db_session)
    assert res["status"] is True

    notis = _of_type(await noti_model.find_by_user(alice, db=db_session), "comment_reply")
    assert len(notis) == 1  # create 시 1건만 — update로 재발송되지 않음
