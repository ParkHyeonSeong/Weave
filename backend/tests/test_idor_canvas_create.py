"""IDOR regression tests for canvas.create branch membership (LOG-08).

Style: direct controller-level calls (no HTTP client), seeding with raw INSERTs
via the rollback-isolated ``db_session`` fixture. See test_track_home.py /
test_idor_workflow_status.py for the shared pattern.

Gap: ``canvas.create`` trusted the caller-supplied ``body.branch_id`` and never
verified the caller was a member of that branch. A non-member could create a
canvas attached to an arbitrary branch (and become its admin), injecting into
that branch's context. The canonical safe pattern verifies branch membership
via ``branch_member.is_member`` before creating.

``canvas.branch_id`` is nullable (CanvasCreate.branch_id: Optional[int] = None):
a canvas may exist without any branch, so ``branch_id=None`` must skip the
membership check (independent canvas = legitimate).
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import canvas as ctrl
from routers.schema import canvas as schema


def _req(user_id: int):
    """controller가 읽는 request.state.payload만 흉내낸다."""
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


# ---------------------------------------------------------------------------
# seed helpers (raw INSERT — real schema column names)
# ---------------------------------------------------------------------------

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


async def _add_branch_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _canvas_count_for_branch(db, branch_id):
    res = await db.execute(text("""
        SELECT COUNT(*) FROM canvas WHERE branch_id = :b
    """), {"b": branch_id})
    return res.scalar_one()


# ---------------------------------------------------------------------------
# IDOR — create on a branch the caller is not a member of
# ---------------------------------------------------------------------------

async def test_create_rejects_non_member_branch(db_session):
    """비멤버 branch로 canvas 생성 시도 → NOT_BRANCH_MEMBER, 아무것도 안 생김."""
    alice = await _make_user(db_session, "alice_cc@idor.test", "alice_cc")
    bob = await _make_user(db_session, "bob_cc@idor.test", "bob_cc")

    # bob의 branch — alice는 멤버가 아니다.
    bob_branch = await _make_branch(db_session, bob, name="BobBranch", key="BOBCC")
    await _add_branch_member(db_session, bob_branch, bob, "admin")

    res = await ctrl.create(
        schema.CanvasCreate(
            canvas_name="Hijacked",
            key="HIJACK",
            visibility="private",
            branch_id=bob_branch,
        ),
        _req(alice), db_session,
    )
    assert res["status"] is False
    assert res["message"] == "NOT_BRANCH_MEMBER"

    # bob_branch에는 canvas가 생기지 않아야 한다.
    assert await _canvas_count_for_branch(db_session, bob_branch) == 0


# ---------------------------------------------------------------------------
# regression — member branch happy path still works
# ---------------------------------------------------------------------------

async def test_create_member_branch_succeeds(db_session):
    """멤버인 branch로 canvas 생성은 정상."""
    alice = await _make_user(db_session, "alice_ok_cc@idor.test", "alice_ok_cc")
    branch = await _make_branch(db_session, alice, name="AliceBranch", key="ALICC")
    await _add_branch_member(db_session, branch, alice, "admin")

    res = await ctrl.create(
        schema.CanvasCreate(
            canvas_name="Alice Canvas",
            key="ACANV",
            visibility="private",
            branch_id=branch,
        ),
        _req(alice), db_session,
    )
    assert res["status"] is True
    assert res["canvas_id"] is not None
    assert await _canvas_count_for_branch(db_session, branch) == 1


# ---------------------------------------------------------------------------
# regression — independent canvas (branch_id=None) still works
# ---------------------------------------------------------------------------

async def test_create_without_branch_succeeds(db_session):
    """branch_id 미지정(독립 canvas)은 멤버십 검증을 건너뛰고 정상 생성."""
    solo = await _make_user(db_session, "solo_cc@idor.test", "solo_cc")

    res = await ctrl.create(
        schema.CanvasCreate(
            canvas_name="Solo Canvas",
            key="SOLO",
            visibility="private",
            branch_id=None,
        ),
        _req(solo), db_session,
    )
    assert res["status"] is True
    assert res["canvas_id"] is not None
