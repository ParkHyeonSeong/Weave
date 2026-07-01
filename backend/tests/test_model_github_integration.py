"""Model tests for github_integration (branch<->repo mapping).

Style: direct model calls, raw-INSERT seed via the rollback-isolated db_session
fixture (same pattern as test_idor_ref_status.py).
"""
from sqlalchemy import text

from core.model import github_integration as ghi
from core.model import task_github_ref as tgr


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="B", key="GHI1"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    return row.scalar_one()


async def test_create_and_find_by_branch(db_session):
    u = await _make_user(db_session, "ghi_a@gh.test", "ghi_a")
    b = await _make_branch(db_session, u, key="GHIA")
    created = await ghi.create(b, "org/repo", 12345, u, db_session)
    assert created["repo_full_name"] == "org/repo"
    assert created["installation_id"] == 12345
    assert created["enabled"] is True
    assert created["branch_id"] == b

    rows = await ghi.find_by_branch(b, db_session)
    assert [r["integration_id"] for r in rows] == [created["integration_id"]]


async def test_find_enabled_and_active_for_repo(db_session):
    u = await _make_user(db_session, "ghi_b@gh.test", "ghi_b")
    b = await _make_branch(db_session, u, key="GHIB")
    created = await ghi.create(b, "org/repo2", 222, u, db_session)

    found = await ghi.find_enabled(b, "org/repo2", db_session)
    assert found is not None and found["integration_id"] == created["integration_id"]
    # case-insensitive repo match (GitHub repo names are case-insensitive)
    assert await ghi.find_enabled(b, "ORG/REPO2", db_session) is not None

    active = await ghi.find_active_for_repo("org/repo2", db_session)
    assert created["integration_id"] in [r["integration_id"] for r in active]


async def test_set_enabled_toggles_and_is_branch_scoped(db_session):
    u = await _make_user(db_session, "ghi_c@gh.test", "ghi_c")
    b = await _make_branch(db_session, u, key="GHIC")
    other = await _make_branch(db_session, u, name="O", key="GHIO")
    created = await ghi.create(b, "org/repo3", 333, u, db_session)

    toggled = await ghi.set_enabled(created["integration_id"], b, False, db_session)
    assert toggled is not None and toggled["enabled"] is False
    # disabled rows are excluded from find_enabled and find_active_for_repo
    assert await ghi.find_enabled(b, "org/repo3", db_session) is None
    assert await ghi.find_active_for_repo("org/repo3", db_session) == []

    # cross-branch set_enabled is a no-op (returns None, row untouched)
    assert await ghi.set_enabled(created["integration_id"], other, True, db_session) is None


async def test_delete_is_tuple_scoped(db_session):
    u = await _make_user(db_session, "ghi_d@gh.test", "ghi_d")
    b = await _make_branch(db_session, u, key="GHID")
    other = await _make_branch(db_session, u, name="O", key="GHID2")
    created = await ghi.create(b, "org/repo4", 444, u, db_session)

    # wrong branch -> no delete, returns None, row survives
    assert await ghi.delete(created["integration_id"], other, db_session) is None
    assert await ghi.find_by_branch(b, db_session) != []

    # correct branch -> deletes, returns the id
    assert await ghi.delete(created["integration_id"], b, db_session) == created["integration_id"]
    assert await ghi.find_by_branch(b, db_session) == []


# ---------------------------------------------------------------------------
# task_github_ref
# ---------------------------------------------------------------------------


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


async def test_upsert_pr_inserts_then_updates(db_session):
    u = await _make_user(db_session, "tgr_a@gh.test", "tgr_a")
    b = await _make_branch(db_session, u, key="TGRA")
    t = await _make_task(db_session, b, u)

    first = await tgr.upsert_pr(t, "org/repo", 7, None, "Open PR", "open",
                                "https://gh/pr/7", u, db_session)
    assert first["ref_type"] == "pull_request"
    assert first["ref_number"] == 7
    assert first["state"] == "open"

    # same (task, repo, number) -> UPDATE (no second row), new state/title applied
    second = await tgr.upsert_pr(t, "org/repo", 7, None, "Merged PR", "merged",
                                 "https://gh/pr/7", None, db_session)
    assert second["ref_id"] == first["ref_id"]
    assert second["state"] == "merged"
    assert second["title"] == "Merged PR"

    rows = await tgr.find_by_task(t, db_session)
    assert len(rows) == 1


async def test_create_manual_ref_and_find_by_task(db_session):
    u = await _make_user(db_session, "tgr_b@gh.test", "tgr_b")
    b = await _make_branch(db_session, u, key="TGRB")
    t = await _make_task(db_session, b, u)

    ref = await tgr.create(t, "org/repo", "pull_request", 9, None, "Manual",
                           "open", "https://gh/pr/9", u, db_session)
    assert ref["linked_by"] == u
    rows = await tgr.find_by_task(t, db_session)
    assert [r["ref_id"] for r in rows] == [ref["ref_id"]]


async def test_tgr_delete_is_tuple_scoped(db_session):
    u = await _make_user(db_session, "tgr_c@gh.test", "tgr_c")
    b = await _make_branch(db_session, u, key="TGRC")
    t1 = await _make_task(db_session, b, u)
    t2 = await _make_task(db_session, b, u, title="t2")
    ref = await tgr.create(t1, "org/repo", "pull_request", 1, None, "x",
                           "open", "https://gh/pr/1", u, db_session)

    # wrong task_id -> None, row survives
    assert await tgr.delete(ref["ref_id"], t2, db_session) is None
    assert len(await tgr.find_by_task(t1, db_session)) == 1
    # correct task_id -> returns ref_id, row gone
    assert await tgr.delete(ref["ref_id"], t1, db_session) == ref["ref_id"]
    assert await tgr.find_by_task(t1, db_session) == []


async def test_count_active_prs_excludes_self_and_closed(db_session):
    u = await _make_user(db_session, "tgr_d@gh.test", "tgr_d")
    b = await _make_branch(db_session, u, key="TGRD")
    t = await _make_task(db_session, b, u)
    open_pr = await tgr.upsert_pr(t, "org/repo", 1, None, "open", "open",
                                  "https://gh/pr/1", None, db_session)
    merged_pr = await tgr.upsert_pr(t, "org/repo", 2, None, "merged", "merged",
                                    "https://gh/pr/2", None, db_session)
    await tgr.upsert_pr(t, "org/repo", 3, None, "closed", "closed",
                        "https://gh/pr/3", None, db_session)

    # active = open|merged; excluding open_pr leaves only merged_pr (closed never counts)
    assert await tgr.count_active_prs(t, open_pr["ref_id"], db_session) == 1
    # excluding nothing (None) counts both open + merged
    assert await tgr.count_active_prs(t, None, db_session) == 2
    _ = merged_pr  # silence unused


async def test_count_active_prs_none_excludes_nothing(db_session):
    """exclude_ref_id=None은 제외 없이 활성 PR 전체를 카운트해야 한다.
    None이 NULL 비교로 처리되면 모든 행이 ref_id != NULL → NULL(falsy)이 되어
    0을 반환하는 버그가 발생하므로 이를 회귀 방지한다."""
    u = await _make_user(db_session, "tgr_e@gh.test", "tgr_e")
    b = await _make_branch(db_session, u, key="TGRE")
    t = await _make_task(db_session, b, u)
    await tgr.upsert_pr(t, "org/repo", 10, None, "open pr", "open",
                        "https://gh/pr/10", None, db_session)
    await tgr.upsert_pr(t, "org/repo", 11, None, "merged pr", "merged",
                        "https://gh/pr/11", None, db_session)
    await tgr.upsert_pr(t, "org/repo", 12, None, "closed pr", "closed",
                        "https://gh/pr/12", None, db_session)

    # None → 제외 없음; open+merged=2, closed는 제외
    assert await tgr.count_active_prs(t, None, db_session) == 2
