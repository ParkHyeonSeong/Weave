"""GET 4경로 format=markdown egress (§3.5) — 같은 필드명으로 md 치환.

시드 헬퍼는 test_ref_status_hydration.py(canvas/issue)와
test_task_comment_order.py(comment)에서 복제. 무효 format의 422는
라우터 Literal 소관(order 파라미터 선례)이라 여기선 컨트롤러만 검증.
"""
from datetime import datetime, timezone
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import canvas_page as page_ctrl
from core.controller import task as task_ctrl
from core.controller import task_comment as comment_ctrl
from core.controller import task_issue as issue_ctrl
from core.model import task_issue as issue_model


def _req(user_id):
    return SimpleNamespace(state=SimpleNamespace(
        payload={"user_id": user_id, "username": "tester"}))


# --- 시드 헬퍼 복제: _make_user/_make_branch/_add_member(test_task_comment_order.py:20-39),
# _make_canvas(test_ref_status_hydration.py:64-74). description/content를 받는 변형 추가: ---

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


async def _make_canvas(db, created_by, name="Canvas", key="CVS"):
    row = await db.execute(text("""
        INSERT INTO canvas (canvas_name, key, created_by)
        VALUES (:n, :k, :u) RETURNING canvas_id
    """), {"n": name, "k": key, "u": created_by})
    cid = row.scalar_one()
    await db.execute(text("""
        INSERT INTO canvas_member (canvas_id, user_id, role)
        VALUES (:c, :u, 'owner')
    """), {"c": cid, "u": created_by})
    return cid


async def _make_task(db, branch_id, created_by, description=None):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, description, status, created_by)
        VALUES (:b, :dn, 'Task', :d, 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "d": description, "u": created_by})
    return res.scalar_one()


async def _make_page(db, canvas_id, created_by, content=''):
    res = await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, created_by)
        VALUES (:c, 'Page', :ct, :u) RETURNING page_id
    """), {"c": canvas_id, "ct": content, "u": created_by})
    return res.scalar_one()


HTML = '<h1>제목</h1><p>본문 <strong>굵게</strong></p>'


async def test_get_task_format_markdown(db_session):
    user = await _make_user(db_session, "eg_a@t.t", "eg_a")
    branch = await _make_branch(db_session, user, name="EG_A", key="EGA")
    await _add_member(db_session, branch, user)
    tid = await _make_task(db_session, branch, user, description=HTML)
    res = await task_ctrl.get_detail(tid, branch, _req(user), db_session, fmt='markdown')
    assert res["status"] is True
    assert res["task"]["description"] == '# 제목\n\n본문 **굵게**'


async def test_get_task_default_html_unchanged(db_session):
    user = await _make_user(db_session, "eg_b@t.t", "eg_b")
    branch = await _make_branch(db_session, user, name="EG_B", key="EGB")
    await _add_member(db_session, branch, user)
    tid = await _make_task(db_session, branch, user, description=HTML)
    res = await task_ctrl.get_detail(tid, branch, _req(user), db_session)
    assert res["task"]["description"] == HTML


async def test_list_comments_format_markdown_skips_deleted(db_session):
    user = await _make_user(db_session, "eg_c@t.t", "eg_c")
    branch = await _make_branch(db_session, user, name="EG_C", key="EGC")
    await _add_member(db_session, branch, user)
    tid = await _make_task(db_session, branch, user)
    row = await db_session.execute(text("""
        INSERT INTO task_comment (task_id, author_id, content, created_at)
        VALUES (:t, :a, :c, :ts) RETURNING comment_id
    """), {"t": tid, "a": user, "c": '<p><strong>댓글</strong></p>',
           "ts": datetime(2026, 7, 1, tzinfo=timezone.utc)})
    cid = row.scalar_one()
    await db_session.execute(text("""
        INSERT INTO task_comment (task_id, author_id, content, created_at, deleted_at)
        VALUES (:t, :a, '<p>del</p>', :ts, now())
    """), {"t": tid, "a": user, "ts": datetime(2026, 7, 2, tzinfo=timezone.utc)})
    res = await comment_ctrl.list_comments(branch, tid, _req(user), db_session,
                                           fmt='markdown')
    by_id = {c["comment_id"]: c for c in res["comments"]}
    assert by_id[cid]["content"] == '**댓글**'
    assert all(c["content"] == '' for c in res["comments"] if c["is_deleted"])


async def test_get_issue_format_markdown_body_comments_timeline(db_session):
    user = await _make_user(db_session, "eg_d@t.t", "eg_d")
    branch = await _make_branch(db_session, user, name="EG_D", key="EGD")
    await _add_member(db_session, branch, user)
    tid = await _make_task(db_session, branch, user)
    row = await db_session.execute(text("""
        INSERT INTO task_issue (task_id, title, body, status, created_by)
        VALUES (:t, 'Issue', :b, 'open', :u) RETURNING issue_id
    """), {"t": tid, "b": '<p><em>본문</em></p>', "u": user})
    iid = row.scalar_one()
    await issue_model.create_comment(iid, user, '<p><code>x</code></p>', db_session)
    res = await issue_ctrl.get_issue(branch, tid, iid, _req(user), db_session,
                                     fmt='markdown')
    assert res["issue"]["body"] == '*본문*'
    assert res["comments"][0]["content"] == '`x`'
    tl = [i for i in res["timeline"] if i["kind"] == "comment"]
    assert tl[0]["content"] == '`x`'   # timeline은 comments dict 공유 — 함께 치환


async def test_get_canvas_page_format_markdown_and_typst_skip(db_session):
    user = await _make_user(db_session, "eg_e@t.t", "eg_e")
    canvas = await _make_canvas(db_session, user, name="C", key="EGE")
    pid = await _make_page(db_session, canvas, user, content=HTML)
    res = await page_ctrl.get_detail(canvas, pid, _req(user), db_session,
                                     fmt='markdown')
    assert res["page"]["content"] == '# 제목\n\n본문 **굵게**'
    # typst 페이지 content는 Typst 소스(비HTML) — 변환하면 안 됨
    row = await db_session.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, type, created_by)
        VALUES (:c, 'T', '#set page(width: 10cm)', 'typst', :u) RETURNING page_id
    """), {"c": canvas, "u": user})
    tp = row.scalar_one()
    res = await page_ctrl.get_detail(canvas, tp, _req(user), db_session,
                                     fmt='markdown')
    assert res["page"]["content"] == '#set page(width: 10cm)'
