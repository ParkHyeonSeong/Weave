"""IDOR / authz regression tests for the GitHub integration + manual ref linking.

Style: direct controller-level calls (no HTTP client), raw-INSERT seed via the
rollback-isolated db_session fixture, request.state.payload faked with
SimpleNamespace. Mirrors test_idor_task_dependency.py.

Two concerns are locked in here:
  * admin-only gate on integration CRUD (member but not admin -> PERMISSION_DENIED)
  * cross-branch IDOR on manual ref unlink: a member of branch A must not be able
    to unlink a ref that lives on a task of branch B. The defense is the STEP1
    member -> STEP2 find_resource_in_branch(task_id, REAL branch_id, 'task') ->
    STEP3 tuple-scoped delete(ref_id, task_id) chain.
"""
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from core.controller import github_integration as int_ctrl
from core.controller import github_ref as ref_ctrl
from routers.schema import github as schema
from core.model import github_integration as ghi
from core.model import task_github_ref as tgr
from library import github_app


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="B", key="KEY"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    bid = row.scalar_one()
    for key_, label, color_, category, sort in [
        ("todo", "To Do", "#9CA3AF", "todo", 0),
        ("in_progress", "In Progress", "#2563EB", "in_progress", 1),
        ("done", "Done", "#16A34A", "done", 2),
        ("cancelled", "Cancelled", "#DC2626", "cancelled", 3),
    ]:
        await db.execute(text("""
            INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order)
            VALUES (:b, :k, :l, :c, :cat, :s)
        """), {"b": bid, "k": key_, "l": label, "c": color_, "cat": category, "s": sort})
    return bid


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by, title="t"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "u": created_by})
    return res.scalar_one()


# ---------------------------------------------------------------------------
# integration CRUD admin gate
# ---------------------------------------------------------------------------

async def test_create_integration_requires_admin(db_session):
    admin = await _make_user(db_session, "ghadm@gh.test", "ghadm")
    plain = await _make_user(db_session, "ghmem@gh.test", "ghmem")
    b = await _make_branch(db_session, admin, key="GADM")
    await _add_member(db_session, b, admin, "admin")
    await _add_member(db_session, b, plain, "member")

    body = schema.IntegrationCreate(repo_full_name="org/repo", installation_id=11)

    # plain member -> denied
    denied = await int_ctrl.create_integration(body, b, _req(plain), db_session)
    assert denied["status"] is False
    assert denied["code"] == "PERMISSION_DENIED"
    assert await ghi.find_by_branch(b, db_session) == []

    # admin -> ok
    ok = await int_ctrl.create_integration(body, b, _req(admin), db_session)
    assert ok["status"] is True
    assert ok["integration"]["repo_full_name"] == "org/repo"


async def test_delete_integration_admin_and_branch_scoped(db_session):
    admin = await _make_user(db_session, "ghadm2@gh.test", "ghadm2")
    b = await _make_branch(db_session, admin, key="GADM2")
    other = await _make_branch(db_session, admin, name="O", key="GOTH")
    await _add_member(db_session, b, admin, "admin")
    await _add_member(db_session, other, admin, "admin")
    created = await ghi.create(b, "org/repo", 11, admin, db_session)

    # deleting via the OTHER branch's URL must not remove b's row
    wrong = await int_ctrl.delete_integration(other, created["integration_id"],
                                               _req(admin), db_session)
    assert wrong["status"] is False
    assert wrong["code"] == "INTEGRATION_NOT_FOUND"
    assert await ghi.find_by_branch(b, db_session) != []

    ok = await int_ctrl.delete_integration(b, created["integration_id"],
                                            _req(admin), db_session)
    assert ok["status"] is True
    assert await ghi.find_by_branch(b, db_session) == []


async def test_set_enabled_admin_and_branch_scoped(db_session):
    admin = await _make_user(db_session, "ghadm3@gh.test", "ghadm3")
    b = await _make_branch(db_session, admin, key="GADM3")
    other = await _make_branch(db_session, admin, name="O3", key="GOT3")
    await _add_member(db_session, b, admin, "admin")
    await _add_member(db_session, other, admin, "admin")
    created = await ghi.create(b, "org/repo", 11, admin, db_session)

    # toggling via the OTHER branch's URL must not affect b's row
    wrong = await int_ctrl.set_enabled(other, created["integration_id"],
                                       schema.IntegrationToggle(enabled=False),
                                       _req(admin), db_session)
    assert wrong["status"] is False
    assert wrong["code"] == "INTEGRATION_NOT_FOUND"
    rows = await ghi.find_by_branch(b, db_session)
    assert len(rows) == 1 and rows[0]["enabled"] is True

    ok = await int_ctrl.set_enabled(b, created["integration_id"],
                                    schema.IntegrationToggle(enabled=False),
                                    _req(admin), db_session)
    assert ok["status"] is True
    assert "integration" in ok
    rows_after = await ghi.find_by_branch(b, db_session)
    assert len(rows_after) == 1 and rows_after[0]["enabled"] is False


async def test_create_integration_duplicate_survives_outer_tx(db_session):
    admin = await _make_user(db_session, "ghadm4@gh.test", "ghadm4")
    b = await _make_branch(db_session, admin, key="GADM4")
    await _add_member(db_session, b, admin, "admin")

    body = schema.IntegrationCreate(repo_full_name="org/dup", installation_id=11)

    first = await int_ctrl.create_integration(body, b, _req(admin), db_session)
    assert first["status"] is True

    second = await int_ctrl.create_integration(body, b, _req(admin), db_session)
    assert second["status"] is False
    assert second["code"] == "DUPLICATE_LINK"

    # Prove the outer tx survived the IntegrityError (savepoint contained it):
    # if the session were in a failed/aborted state, this query would raise
    # PendingRollbackError / InFailedSqlTransaction instead of returning.
    rows = await ghi.find_by_branch(b, db_session)
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# cross-branch IDOR — manual ref unlink/link
# ---------------------------------------------------------------------------


def _async_pr(**fields):
    """github_app.fetch_pull_request monkeypatch용 — 가짜 PR dict를 반환하는 async fn."""
    async def _f(*a, **k):
        return fields
    return _f


async def test_cross_branch_unlink_via_foreign_task_denied(db_session):
    """alice(branchA 멤버)가 URL을 branch_id=A / task_id=B(branchB)로 위조해도
    STEP2 task-in-branch 가드가 TASK_NOT_FOUND로 막고 refB는 살아남는다."""
    alice = await _make_user(db_session, "idor_a@gh.test", "idor_a")
    bob = await _make_user(db_session, "idor_b@gh.test", "idor_b")

    branch_a = await _make_branch(db_session, alice, name="A", key="IDRA")
    await _add_member(db_session, branch_a, alice, "member")

    branch_b = await _make_branch(db_session, bob, name="B", key="IDRB")
    await _add_member(db_session, branch_b, bob, "admin")
    task_b = await _make_task(db_session, branch_b, bob, title="B task")
    ref_b = await tgr.create(task_b, "org/repo", "pull_request", 5, None, "B PR",
                             "open", "https://gh/pr/5", bob, db_session)

    # alice는 branchA 멤버지만 task_b는 branchB 소속 -> STEP2에서 TASK_NOT_FOUND
    res = await ref_ctrl.unlink_ref(branch_a, task_b, ref_b["ref_id"],
                                    _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "TASK_NOT_FOUND"
    # refB는 그대로 살아있다
    assert ref_b["ref_id"] in [r["ref_id"] for r in await tgr.find_by_task(task_b, db_session)]


async def test_cross_branch_unlink_via_foreign_ref_denied(db_session):
    """alice가 자기 task_a에 refB의 ref_id로 unlink 시도해도 STEP3 튜플 삭제가
    (ref_id, task_a)로 0행이라 REF_NOT_FOUND, refB는 살아남는다."""
    alice = await _make_user(db_session, "idor_c@gh.test", "idor_c")
    bob = await _make_user(db_session, "idor_d@gh.test", "idor_d")

    branch_a = await _make_branch(db_session, alice, name="A", key="IDRC")
    await _add_member(db_session, branch_a, alice, "member")
    task_a = await _make_task(db_session, branch_a, alice, title="A task")

    branch_b = await _make_branch(db_session, bob, name="B", key="IDRD")
    await _add_member(db_session, branch_b, bob, "admin")
    task_b = await _make_task(db_session, branch_b, bob, title="B task")
    ref_b = await tgr.create(task_b, "org/repo", "pull_request", 6, None, "B PR",
                             "open", "https://gh/pr/6", bob, db_session)

    # branch_a + task_a는 alice가 정당하게 접근 가능하지만 ref_b는 task_b 소속
    res = await ref_ctrl.unlink_ref(branch_a, task_a, ref_b["ref_id"],
                                    _req(alice), db_session)
    assert res["status"] is False
    assert res["code"] == "REF_NOT_FOUND"
    assert ref_b["ref_id"] in [r["ref_id"] for r in await tgr.find_by_task(task_b, db_session)]


async def test_own_ref_unlink_succeeds(db_session):
    """회귀: 본인 branch/task의 ref는 정상 해제된다."""
    alice = await _make_user(db_session, "idor_e@gh.test", "idor_e")
    branch_a = await _make_branch(db_session, alice, name="A", key="IDRE")
    await _add_member(db_session, branch_a, alice, "member")
    task_a = await _make_task(db_session, branch_a, alice, title="A task")
    ref_a = await tgr.create(task_a, "org/repo", "pull_request", 7, None, "A PR",
                             "open", "https://gh/pr/7", alice, db_session)

    res = await ref_ctrl.unlink_ref(branch_a, task_a, ref_a["ref_id"],
                                    _req(alice), db_session)
    assert res["status"] is True
    assert await tgr.find_by_task(task_a, db_session) == []


async def test_non_member_cannot_list_or_link(db_session):
    """STEP1: branchA 비멤버는 list/link 모두 NOT_BRANCH_MEMBER."""
    alice = await _make_user(db_session, "idor_f@gh.test", "idor_f")
    intruder = await _make_user(db_session, "idor_g@gh.test", "idor_g")
    branch_a = await _make_branch(db_session, alice, name="A", key="IDRF")
    await _add_member(db_session, branch_a, alice, "member")
    task_a = await _make_task(db_session, branch_a, alice, title="A task")

    listed = await ref_ctrl.list_refs(branch_a, task_a, _req(intruder), db_session)
    assert listed["status"] is False
    assert listed["code"] == "NOT_BRANCH_MEMBER"

    body = schema.RefLinkCreate(html_url="https://github.com/org/repo/pull/8")
    linked = await ref_ctrl.link_ref(body, branch_a, task_a, _req(intruder), db_session)
    assert linked["status"] is False
    assert linked["code"] == "NOT_BRANCH_MEMBER"


async def test_own_branch_link_succeeds(db_session, monkeypatch):
    """회귀: 멤버가 연결된 repo의 PR을 본인 task에 link하면 메타와 함께 ref가 생성된다."""
    alice = await _make_user(db_session, "idor_h@gh.test", "idor_h")
    branch_a = await _make_branch(db_session, alice, name="A", key="IDRH")
    await _add_member(db_session, branch_a, alice, "member")
    task_a = await _make_task(db_session, branch_a, alice, title="A task")
    await ghi.create(branch_a, "org/repo", 123, alice, db_session)  # repo가 연결돼 있어야 함
    monkeypatch.setattr(ref_ctrl.config, "GITHUB_APP_ID", "1")
    monkeypatch.setattr(ref_ctrl.config, "GITHUB_APP_PRIVATE_KEY", "stub_key")
    monkeypatch.setattr(github_app, "fetch_pull_request",
                        _async_pr(number=9, title="Hi", state="open", merged=False,
                                  merge_commit_sha=None,
                                  html_url="https://github.com/org/repo/pull/9"))

    body = schema.RefLinkCreate(html_url="https://github.com/org/repo/pull/9")
    res = await ref_ctrl.link_ref(body, branch_a, task_a, _req(alice), db_session)
    assert res["status"] is True
    assert res["ref"]["ref_number"] == 9
    assert res["ref"]["title"] == "Hi" and res["ref"]["state"] == "open"
    assert res["ref"]["linked_by"] == alice


async def test_duplicate_link_conflict_keeps_session_usable(db_session, monkeypatch):
    """수동 link 중복 → DUPLICATE_LINK, 그리고 savepoint 덕분에 후속 쿼리가 살아있다."""
    alice = await _make_user(db_session, "idor_dup@gh.test", "idor_dup")
    branch_a = await _make_branch(db_session, alice, name="A", key="IDRP")
    await _add_member(db_session, branch_a, alice, "member")
    task_a = await _make_task(db_session, branch_a, alice, title="A task")
    await ghi.create(branch_a, "org/repo", 123, alice, db_session)
    monkeypatch.setattr(ref_ctrl.config, "GITHUB_APP_ID", "1")
    monkeypatch.setattr(ref_ctrl.config, "GITHUB_APP_PRIVATE_KEY", "stub_key")
    monkeypatch.setattr(github_app, "fetch_pull_request",
                        _async_pr(number=77, title="Dup", state="open", merged=False,
                                  merge_commit_sha=None,
                                  html_url="https://github.com/org/repo/pull/77"))
    url = "https://github.com/org/repo/pull/77"
    first = await ref_ctrl.link_ref(schema.RefLinkCreate(html_url=url),
                                    branch_a, task_a, _req(alice), db_session)
    assert first["status"] is True
    dup = await ref_ctrl.link_ref(schema.RefLinkCreate(html_url=url),
                                  branch_a, task_a, _req(alice), db_session)
    assert dup["status"] is False and dup["code"] == "DUPLICATE_LINK"
    # savepoint가 바깥 트랜잭션을 살렸는지: 후속 read가 정상이어야 한다
    listed = await ref_ctrl.list_refs(branch_a, task_a, _req(alice), db_session)
    assert listed["status"] is True and len(listed["refs"]) == 1


@pytest.mark.parametrize("spoof_url", [
    "https://evil.example/?u=github.com/org/repo/pull/1",   # 부분문자열 위장
    "https://github.com.evil.com/org/repo/pull/1",           # 서브도메인 위장
    "https://user@github.com/org/repo/pull/1",               # userinfo 위장 (netloc = user@github.com)
    "http://github.com.evil.com/org/repo/pull/2",            # http 스킴 + 서브도메인 위장
])
async def test_link_rejects_host_spoof_url(spoof_url, db_session):
    """P2: host가 정확히 github.com이 아닌 모든 host-spoof 변형은 INVALID_GITHUB_URL.

    integration 조회/fetch 이전(URL 검증 단계)에서 막히므로 시드/모킹이 필요 없다.
    멤버십 게이트를 통과시켜 URL 검증이 실제 거부 원인임을 확인하기 위해 alice 시드는 유지한다."""
    alice = await _make_user(db_session, f"idor_url_{abs(hash(spoof_url)) % 10000}@gh.test",
                             f"idor_url_{abs(hash(spoof_url)) % 10000}")
    branch_a = await _make_branch(db_session, alice, name="A",
                                  key=f"IDU{abs(hash(spoof_url)) % 1000:03d}")
    await _add_member(db_session, branch_a, alice, "member")
    task_a = await _make_task(db_session, branch_a, alice, title="A task")
    body = schema.RefLinkCreate(html_url=spoof_url)
    res = await ref_ctrl.link_ref(body, branch_a, task_a, _req(alice), db_session)
    assert res["status"] is False and res["code"] == "INVALID_GITHUB_URL"


async def test_duplicate_integration_conflict_keeps_session_usable(db_session):
    """admin repo 연결 중복 → DUPLICATE_LINK + 후속 쿼리 정상(savepoint)."""
    from core.controller import github_integration as ghi_ctrl
    admin = await _make_user(db_session, "idor_gi@gh.test", "idor_gi")
    branch_a = await _make_branch(db_session, admin, name="A", key="IDRG")
    await _add_member(db_session, branch_a, admin, "admin")
    body = schema.IntegrationCreate(repo_full_name="org/repo", installation_id=123)
    first = await ghi_ctrl.create_integration(body, branch_a, _req(admin), db_session)
    assert first["status"] is True
    dup = await ghi_ctrl.create_integration(body, branch_a, _req(admin), db_session)
    assert dup["status"] is False and dup["code"] == "DUPLICATE_LINK"
    listed = await ghi_ctrl.list_integrations(branch_a, _req(admin), db_session)
    assert listed["status"] is True and len(listed["integrations"]) == 1


async def test_link_repo_not_connected(db_session):
    """멤버가 형식은 맞지만 이 브랜치에 연결 안 된 repo의 PR을 link하면 REPO_NOT_CONNECTED."""
    alice = await _make_user(db_session, "idor_rnc@gh.test", "idor_rnc")
    branch_a = await _make_branch(db_session, alice, name="A", key="IDRN")
    await _add_member(db_session, branch_a, alice, "member")
    task_a = await _make_task(db_session, branch_a, alice, title="A task")
    body = schema.RefLinkCreate(html_url="https://github.com/org/unconnected/pull/1")
    res = await ref_ctrl.link_ref(body, branch_a, task_a, _req(alice), db_session)
    assert res["status"] is False and res["code"] == "REPO_NOT_CONNECTED"


# ---------------------------------------------------------------------------
# P2 data-integrity: repo_full_name case-variant duplicates
# ---------------------------------------------------------------------------


async def test_create_integration_case_variant_is_duplicate(db_session):
    """조회는 LOWER 매칭이지만 저장은 대소문자 보존이었던 버그: Org/Repo와 org/repo가
    같은 브랜치에 둘 다 연결될 수 있었다. 모델 write 시 소문자 정규화 후에는
    두 번째 연결이 기존 UNIQUE(branch_id, repo_full_name)에 부딪혀 DUPLICATE_LINK."""
    admin = await _make_user(db_session, "ghcase@gh.test", "ghcase")
    b = await _make_branch(db_session, admin, key="GHCS")
    await _add_member(db_session, b, admin, "admin")

    first = await int_ctrl.create_integration(
        schema.IntegrationCreate(repo_full_name="Org/Repo", installation_id=11),
        b, _req(admin), db_session)
    assert first["status"] is True
    assert first["integration"]["repo_full_name"] == "org/repo"  # normalized

    dup = await int_ctrl.create_integration(
        schema.IntegrationCreate(repo_full_name="org/repo", installation_id=11),
        b, _req(admin), db_session)
    assert dup["status"] is False and dup["code"] == "DUPLICATE_LINK"

    rows = await ghi.find_by_branch(b, db_session)
    assert len(rows) == 1


async def test_link_case_variant_pr_is_duplicate(db_session, monkeypatch):
    """같은 PR을 URL 케이스만 바꿔 수동 link하면 두 번째가 정규화된
    uq_tgr_pr(task_id, repo_full_name, ref_number)에 부딪혀 DUPLICATE_LINK."""
    alice = await _make_user(db_session, "ghlc@gh.test", "ghlc")
    b = await _make_branch(db_session, alice, name="A", key="GHLC")
    await _add_member(db_session, b, alice, "member")
    task_a = await _make_task(db_session, b, alice, title="t")
    await ghi.create(b, "org/repo", 123, alice, db_session)  # repo가 연결돼 있어야 함

    monkeypatch.setattr(ref_ctrl.config, "GITHUB_APP_ID", "1")
    monkeypatch.setattr(ref_ctrl.config, "GITHUB_APP_PRIVATE_KEY", "stub_key")
    monkeypatch.setattr(github_app, "fetch_pull_request",
                        _async_pr(number=9, title="Hi", state="open", merged=False,
                                  merge_commit_sha=None,
                                  html_url="https://github.com/Org/Repo/pull/9"))

    first = await ref_ctrl.link_ref(
        schema.RefLinkCreate(html_url="https://github.com/Org/Repo/pull/9"),
        b, task_a, _req(alice), db_session)
    assert first["status"] is True
    assert first["ref"]["repo_full_name"] == "org/repo"  # normalized

    dup = await ref_ctrl.link_ref(
        schema.RefLinkCreate(html_url="https://github.com/org/repo/pull/9"),
        b, task_a, _req(alice), db_session)
    assert dup["status"] is False and dup["code"] == "DUPLICATE_LINK"

    refs = await tgr.find_by_task(task_a, db_session)
    assert len(refs) == 1
