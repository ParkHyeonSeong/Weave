from types import SimpleNamespace

from sqlalchemy import text

from core.controller import scrum_board as ctrl
from core.model import scrum_member as member_model
from routers.schema import scrum_board as schema


def _req(user_id: int):
    """controller가 읽는 request.state.payload만 흉내낸다."""
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def test_create_adds_creator_as_admin(db_session):
    uid = await _make_user(db_session, "c1@test.local", "c1")
    res = await ctrl.create(schema.ScrumBoardCreate(name="디자인팀"), _req(uid), db_session)
    assert res["status"] is True
    bid = res["board_id"]
    assert await member_model.get_role(bid, uid, db_session) == "admin"


async def test_get_detail_private_denies_nonmember(db_session):
    owner = await _make_user(db_session, "c2a@test.local", "c2a")
    stranger = await _make_user(db_session, "c2b@test.local", "c2b")
    res = await ctrl.create(schema.ScrumBoardCreate(name="비공개팀"), _req(owner), db_session)
    bid = res["board_id"]

    denied = await ctrl.get_detail(bid, _req(stranger), db_session)
    assert denied["status"] is False
    assert denied["message"] == "ACCESS_DENIED"

    ok = await ctrl.get_detail(bid, _req(owner), db_session)
    assert ok["status"] is True
    assert ok["board"]["my_role"] == "admin"


async def test_update_requires_admin(db_session):
    owner = await _make_user(db_session, "c3a@test.local", "c3a")
    member = await _make_user(db_session, "c3b@test.local", "c3b")
    res = await ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    await member_model.add(bid, member, "member", db_session)

    denied = await ctrl.update(bid, schema.ScrumBoardUpdate(name="x"), _req(member), db_session)
    assert denied["status"] is False
    assert denied["message"] == "PERMISSION_DENIED"

    ok = await ctrl.update(bid, schema.ScrumBoardUpdate(name="x"), _req(owner), db_session)
    assert ok["status"] is True


async def test_delete_archives(db_session):
    owner = await _make_user(db_session, "c4@test.local", "c4")
    res = await ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    out = await ctrl.delete(bid, _req(owner), db_session)
    assert out["status"] is True
    detail = await ctrl.get_detail(bid, _req(owner), db_session)
    assert detail["status"] is False
    assert detail["message"] == "BOARD_NOT_FOUND"


async def test_add_member_requires_admin(db_session):
    owner = await _make_user(db_session, "c5a@test.local", "c5a")
    member = await _make_user(db_session, "c5b@test.local", "c5b")
    target = await _make_user(db_session, "c5c@test.local", "c5c")
    res = await ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    await member_model.add(bid, member, "member", db_session)

    denied = await ctrl.add_member(bid, schema.ScrumMemberAdd(user_id=target), _req(member), db_session)
    assert denied["status"] is False

    ok = await ctrl.add_member(bid, schema.ScrumMemberAdd(user_id=target), _req(owner), db_session)
    assert ok["status"] is True
    assert await member_model.get_role(bid, target, db_session) == "member"


async def test_last_admin_cannot_be_demoted(db_session):
    owner = await _make_user(db_session, "c6@test.local", "c6")
    res = await ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    out = await ctrl.update_member_role(
        bid, owner, schema.ScrumMemberRoleUpdate(role="member"), _req(owner), db_session)
    assert out["status"] is False
    assert out["message"] == "LAST_ADMIN"


async def test_last_admin_cannot_be_removed(db_session):
    owner = await _make_user(db_session, "c7@test.local", "c7")
    res = await ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    out = await ctrl.remove_member(bid, owner, _req(owner), db_session)
    assert out["status"] is False
    assert out["message"] == "LAST_ADMIN"


async def test_add_member_cannot_demote_last_admin(db_session):
    # add는 upsert이므로 기존 admin을 member로 재추가하는 강등 경로도 막혀야 함
    owner = await _make_user(db_session, "c8@test.local", "c8")
    res = await ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    out = await ctrl.add_member(
        bid, schema.ScrumMemberAdd(user_id=owner, role="member"), _req(owner), db_session)
    assert out["status"] is False
    assert out["message"] == "LAST_ADMIN"


async def test_public_board_readable_by_nonmember(db_session):
    owner = await _make_user(db_session, "c9a@test.local", "c9a")
    stranger = await _make_user(db_session, "c9b@test.local", "c9b")
    res = await ctrl.create(
        schema.ScrumBoardCreate(name="공개팀", visibility="public"), _req(owner), db_session)
    bid = res["board_id"]
    out = await ctrl.get_detail(bid, _req(stranger), db_session)
    assert out["status"] is True
    assert out["board"]["my_role"] is None


async def test_get_members_visibility(db_session):
    # private 보드: 비멤버 차단 / 멤버 허용 — get_detail과 동일 규칙
    owner = await _make_user(db_session, "c10a@test.local", "c10a")
    stranger = await _make_user(db_session, "c10b@test.local", "c10b")
    res = await ctrl.create(schema.ScrumBoardCreate(name="비공개"), _req(owner), db_session)
    bid = res["board_id"]
    denied = await ctrl.get_members(bid, _req(stranger), db_session)
    assert denied["status"] is False
    assert denied["message"] == "ACCESS_DENIED"
    ok = await ctrl.get_members(bid, _req(owner), db_session)
    assert ok["status"] is True
    assert len(ok["members"]) == 1

    # public 보드: 비멤버도 멤버 목록 조회 가능 (get_detail과 일관)
    pub = await ctrl.create(
        schema.ScrumBoardCreate(name="공개", visibility="public"), _req(owner), db_session)
    pub_ok = await ctrl.get_members(pub["board_id"], _req(stranger), db_session)
    assert pub_ok["status"] is True


async def test_member_can_leave_themselves(db_session):
    # 일반 멤버는 본인 탈퇴 가능(admin 아님)하지만 남은 제거 불가
    owner = await _make_user(db_session, "c11a@test.local", "c11a")
    member = await _make_user(db_session, "c11b@test.local", "c11b")
    other = await _make_user(db_session, "c11c@test.local", "c11c")
    res = await ctrl.create(schema.ScrumBoardCreate(name="t"), _req(owner), db_session)
    bid = res["board_id"]
    await member_model.add(bid, member, "member", db_session)
    await member_model.add(bid, other, "member", db_session)

    # 본인 탈퇴 OK
    leave = await ctrl.remove_member(bid, member, _req(member), db_session)
    assert leave["status"] is True
    assert await member_model.is_member(bid, member, db_session) is False

    # 남을 제거하려 하면 admin 아니므로 거부
    denied = await ctrl.remove_member(bid, owner, _req(other), db_session)
    assert denied["status"] is False
    assert denied["message"] == "PERMISSION_DENIED"
