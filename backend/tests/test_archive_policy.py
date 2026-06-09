"""삭제 정책 통일(아카이브) + 보관함(복원/영구삭제) 컨트롤러 테스트."""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import branch as branch_ctrl
from core.controller import canvas as canvas_ctrl
from core.controller import track as track_ctrl
from core.controller import scrum_board as scrum_ctrl
from core.model import scrum_member as scrum_member_model
from core.model import canvas_member as canvas_member_model
from routers.schema import branch as branch_schema
from routers.schema import canvas as canvas_schema
from routers.schema import track as track_schema
from routers.schema import scrum_board as scrum_schema


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


# ----- 아카이브 단일화 + 보관함 노출 -----

async def test_canvas_delete_archives_then_restore(db_session):
    admin = await _make_user(db_session, "av_cv@test.local", "av_cv")
    res = await canvas_ctrl.create(
        canvas_schema.CanvasCreate(canvas_name="t", key="AVCV"), _req(admin), db_session)
    cid = res["canvas_id"]

    assert (await canvas_ctrl.delete(cid, _req(admin), db_session))["status"] is True
    # 일반 목록에서 빠지고 보관함에 노출
    listing = await canvas_ctrl.get_list(_req(admin), db_session)
    assert cid not in [c["canvas_id"] for c in listing["canvases"]]
    arch = await canvas_ctrl.list_archived(_req(admin), db_session)
    assert cid in [c["canvas_id"] for c in arch["canvases"]]
    # 행 보존(소프트) — 복원하면 목록 복귀
    assert (await canvas_ctrl.restore(cid, _req(admin), db_session))["status"] is True
    listing2 = await canvas_ctrl.get_list(_req(admin), db_session)
    assert cid in [c["canvas_id"] for c in listing2["canvases"]]


async def test_track_delete_archives_then_restore(db_session):
    owner = await _make_user(db_session, "av_tk@test.local", "av_tk")
    res = await track_ctrl.create(track_schema.TrackCreate(track_name="t"), _req(owner), db_session)
    tid = res["track_id"]

    assert (await track_ctrl.delete(tid, _req(owner), db_session))["status"] is True
    listing = await track_ctrl.get_list(_req(owner), db_session)
    assert tid not in [t["track_id"] for t in listing["tracks"]]
    arch = await track_ctrl.list_archived(_req(owner), db_session)
    assert tid in [t["track_id"] for t in arch["tracks"]]
    assert (await track_ctrl.restore(tid, _req(owner), db_session))["status"] is True
    listing2 = await track_ctrl.get_list(_req(owner), db_session)
    assert tid in [t["track_id"] for t in listing2["tracks"]]


async def test_scrum_archive_list_restore_roundtrip(db_session):
    admin = await _make_user(db_session, "av_sc@test.local", "av_sc")
    res = await scrum_ctrl.create(scrum_schema.ScrumBoardCreate(name="t"), _req(admin), db_session)
    bid = res["board_id"]

    assert (await scrum_ctrl.delete(bid, _req(admin), db_session))["status"] is True
    arch = await scrum_ctrl.list_archived(_req(admin), db_session)
    assert bid in [b["board_id"] for b in arch["boards"]]
    listing = await scrum_ctrl.get_list(_req(admin), db_session)
    assert bid not in [b["board_id"] for b in listing["boards"]]
    assert (await scrum_ctrl.restore(bid, _req(admin), db_session))["status"] is True
    listing2 = await scrum_ctrl.get_list(_req(admin), db_session)
    assert bid in [b["board_id"] for b in listing2["boards"]]


# ----- 권한: 비관리자는 복원/영구삭제 불가 -----

async def test_scrum_restore_requires_admin(db_session):
    admin = await _make_user(db_session, "pm_a@test.local", "pm_a")
    member = await _make_user(db_session, "pm_b@test.local", "pm_b")
    res = await scrum_ctrl.create(scrum_schema.ScrumBoardCreate(name="t"), _req(admin), db_session)
    bid = res["board_id"]
    await scrum_member_model.add(bid, member, "member", db_session)
    await scrum_ctrl.delete(bid, _req(admin), db_session)

    denied = await scrum_ctrl.restore(bid, _req(member), db_session)
    assert denied["status"] is False
    # 멤버에게는 보관함에 보이지도 않음(admin인 것만)
    arch = await scrum_ctrl.list_archived(_req(member), db_session)
    assert bid not in [b["board_id"] for b in arch["boards"]]


async def test_canvas_permanent_requires_admin(db_session):
    admin = await _make_user(db_session, "cp_a@test.local", "cp_a")
    member = await _make_user(db_session, "cp_b@test.local", "cp_b")
    res = await canvas_ctrl.create(
        canvas_schema.CanvasCreate(canvas_name="t", key="CPRM"), _req(admin), db_session)
    cid = res["canvas_id"]
    await canvas_member_model.add(cid, member, "member", db_session)
    await canvas_ctrl.delete(cid, _req(admin), db_session)

    denied = await canvas_ctrl.permanent_delete(cid, _req(member), db_session)
    assert denied["status"] is False
    # 영구삭제 거부됐으니 행은 남아있어야 함
    row = (await db_session.execute(
        text("SELECT 1 FROM canvas WHERE canvas_id=:c"), {"c": cid})).fetchone()
    assert row is not None


# ----- 영구삭제: 카스케이드 + orphan 정리 -----

async def test_scrum_permanent_cascades_members(db_session):
    admin = await _make_user(db_session, "sp_a@test.local", "sp_a")
    res = await scrum_ctrl.create(scrum_schema.ScrumBoardCreate(name="t"), _req(admin), db_session)
    bid = res["board_id"]
    await scrum_ctrl.delete(bid, _req(admin), db_session)

    assert (await scrum_ctrl.permanent_delete(bid, _req(admin), db_session))["status"] is True
    assert (await db_session.execute(
        text("SELECT 1 FROM scrum_board WHERE board_id=:b"), {"b": bid})).fetchone() is None
    assert (await db_session.execute(
        text("SELECT 1 FROM scrum_member WHERE board_id=:b"), {"b": bid})).fetchone() is None


async def test_branch_permanent_no_orphans_and_canvas_detached(db_session):
    admin = await _make_user(db_session, "bp_a@test.local", "bp_a")
    res = await branch_ctrl.create(
        branch_schema.BranchCreate(branch_name="t", key="BPRM"), _req(admin), db_session)
    bid = res["branch_id"]

    # task 1개
    trow = await db_session.execute(text("""
        INSERT INTO task (branch_id, display_number, title, created_by)
        VALUES (:b, 1, 'x', :u) RETURNING task_id
    """), {"b": bid, "u": admin})
    tid = trow.scalar_one()
    # 그 task를 가리키는 recent_view 1행(FK 없는 poly 참조)
    await db_session.execute(text("""
        INSERT INTO recent_view (user_id, item_type, item_id, viewed_at)
        VALUES (:u, 'task', :t, NOW())
    """), {"u": admin, "t": tid})
    # 이 branch에 연결된 canvas 1개(detach 대상)
    cres = await canvas_ctrl.create(
        canvas_schema.CanvasCreate(canvas_name="cv", key="BPCV", branch_id=bid),
        _req(admin), db_session)
    cid = cres["canvas_id"]

    await branch_ctrl.delete(bid, _req(admin), db_session)
    assert (await branch_ctrl.permanent_delete(bid, _req(admin), db_session))["status"] is True

    # branch / task / recent_view(task) 제거
    assert (await db_session.execute(
        text("SELECT 1 FROM branch WHERE branch_id=:b"), {"b": bid})).fetchone() is None
    assert (await db_session.execute(
        text("SELECT 1 FROM task WHERE task_id=:t"), {"t": tid})).fetchone() is None
    assert (await db_session.execute(
        text("SELECT 1 FROM recent_view WHERE item_type='task' AND item_id=:t"),
        {"t": tid})).fetchone() is None
    # canvas는 detach되어 생존(branch_id NULL)
    row = (await db_session.execute(
        text("SELECT branch_id FROM canvas WHERE canvas_id=:c"), {"c": cid})).fetchone()
    assert row is not None and row[0] is None
