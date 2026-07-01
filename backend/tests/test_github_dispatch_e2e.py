"""E2E: GitHub webhook dispatch -> ref upsert + task transition + activity log.

Model/controller-level (no HTTP client where avoidable). Seeds with raw INSERTs
on the rollback-isolated db_session fixture (see test_idor_ref_status.py).
"""
import hashlib
import hmac
import json

from sqlalchemy import text

from core.model import branch as branch_model


# --- seed helpers (raw INSERT — real schema column names) -----------------
async def _make_user(db, email, username, is_system=False):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, is_system)
        VALUES (:e, :p, :u, 'active', :sys) RETURNING user_id
    """), {"e": email, "p": b"x", "u": username, "sys": is_system})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Branch", key="GHKEY"):
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


async def _make_task(db, branch_id, created_by, title="Task", status="in_progress"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, :s, :u) RETURNING task_id, display_number
    """), {"b": branch_id, "dn": dn, "t": title, "s": status, "u": created_by})
    r = res.fetchone()
    return r[0], r[1]


async def _make_integration(db, branch_id, repo, installation_id, created_by):
    await db.execute(text("""
        INSERT INTO github_integration (branch_id, repo_full_name, installation_id, created_by)
        VALUES (:b, :r, :i, :u)
    """), {"b": branch_id, "r": repo, "i": installation_id, "u": created_by})


async def _system_bot(db):
    row = await db.execute(text(
        "SELECT user_id FROM \"user\" WHERE is_system = TRUE ORDER BY user_id LIMIT 1"))
    r = row.fetchone()
    return r[0] if r else None


# --- find_by_key_row -------------------------------------------------------
async def test_find_by_key_row_case_insensitive(db_session):
    alice = await _make_user(db_session, "a_fk@gh.test", "a_fk")
    bid = await _make_branch(db_session, alice, key="WVX")
    row = await branch_model.find_by_key_row("wvx", db_session)
    assert row is not None
    assert row["branch_id"] == bid
    assert row["key"] == "WVX"


async def test_find_by_key_row_missing_returns_none(db_session):
    assert await branch_model.find_by_key_row("NOPE", db_session) is None


from core.controller import github as github_controller


def _pr_payload(repo, action, merged, number, title, body, head_ref, html_url, state=None):
    # GitHub sends pull_request.state='closed' for 'closed' action (merged or not),
    # 'open' for all other actions. Caller may override via state=.
    if state is None:
        state = 'closed' if action == 'closed' else 'open'
    return {
        "action": action,
        "repository": {"full_name": repo},
        "pull_request": {
            "merged": merged,
            "number": number,
            "title": title,
            "body": body,
            "head": {"ref": head_ref},
            "html_url": html_url,
            "state": state,
            "user": {"login": "octocat"},
        },
    }


async def _branch_with_task(db, key, repo, status="in_progress"):
    owner = await _make_user(db, f"own_{key}@gh.test", f"own_{key}")
    bid = await _make_branch(db, owner, key=key)
    await _add_member(db, bid, owner, "admin")
    tid, dn = await _make_task(db, bid, owner, status=status)
    await _make_integration(db, bid, repo, 555, owner)
    # ensure a GitHub system bot exists for actor_id
    bot = await _system_bot(db)
    if bot is None:
        bot = await _make_user(db, "github-bot@weave.local", "GitHub", is_system=True)
    return bid, tid, dn, owner


async def _task_status(db, task_id):
    r = await db.execute(text("SELECT status FROM task WHERE task_id = :t"), {"t": task_id})
    return r.scalar_one()


async def _ref_state(db, task_id):
    r = await db.execute(text(
        "SELECT state FROM task_github_ref WHERE task_id = :t AND ref_type='pull_request'"),
        {"t": task_id})
    row = r.fetchone()
    return row[0] if row else None


async def test_dispatch_merged_moves_to_done(db_session):
    bid, tid, dn, _ = await _branch_with_task(db_session, "DMGD", "org/repo")
    payload = _pr_payload("org/repo", "closed", True, 12,
                          f"Implement DMGD-{dn}", "body text", "feature/x",
                          "https://github.com/org/repo/pull/12")
    await github_controller.dispatch_event("pull_request", payload, db_session)
    assert await _task_status(db_session, tid) == "done"
    assert await _ref_state(db_session, tid) == "merged"


async def test_dispatch_opened_moves_to_in_progress(db_session):
    bid, tid, dn, _ = await _branch_with_task(db_session, "DOPI", "org/repo2", status="todo")
    payload = _pr_payload("org/repo2", "opened", False, 5, "PR title",
                          f"closes DOPI-{dn}", "feature/y",
                          "https://github.com/org/repo2/pull/5")
    await github_controller.dispatch_event("pull_request", payload, db_session)
    assert await _task_status(db_session, tid) == "in_progress"
    assert await _ref_state(db_session, tid) == "open"


async def test_dispatch_closed_unmerged_moves_to_todo(db_session):
    bid, tid, dn, _ = await _branch_with_task(db_session, "DCUT", "org/repo3", status="in_progress")
    payload = _pr_payload("org/repo3", "closed", False, 9, f"DCUT-{dn} wip",
                          "", "feature/z", "https://github.com/org/repo3/pull/9")
    await github_controller.dispatch_event("pull_request", payload, db_session)
    assert await _task_status(db_session, tid) == "todo"
    assert await _ref_state(db_session, tid) == "closed"


async def test_dispatch_skips_when_integration_not_enabled(db_session):
    # task exists but NO github_integration row for the repo -> no ref, no move
    owner = await _make_user(db_session, "own_skip@gh.test", "own_skip")
    bid = await _make_branch(db_session, owner, key="DSKP")
    await _add_member(db_session, bid, owner, "admin")
    tid, dn = await _make_task(db_session, bid, owner, status="in_progress")
    payload = _pr_payload("org/unlinked", "closed", True, 3, f"DSKP-{dn}",
                          "", "feature/x", "https://github.com/org/unlinked/pull/3")
    await github_controller.dispatch_event("pull_request", payload, db_session)
    assert await _task_status(db_session, tid) == "in_progress"
    assert await _ref_state(db_session, tid) is None


async def test_dispatch_logs_activity_on_merge(db_session):
    bid, tid, dn, _ = await _branch_with_task(db_session, "DLOG", "org/log")
    payload = _pr_payload("org/log", "closed", True, 1, f"DLOG-{dn}",
                          "", "feature/x", "https://github.com/org/log/pull/1")
    await github_controller.dispatch_event("pull_request", payload, db_session)
    r = await db_session.execute(text("""
        SELECT COUNT(*) FROM activity_log
        WHERE entity_type = 'task' AND entity_id = :tid
    """), {"tid": tid})
    assert r.scalar_one() >= 1


# --- webhook router tests (HMAC-verified, ASGI) ----------------------------
import contextlib
import importlib

from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

import db_engine


def _sign(secret: str, raw: bytes) -> str:
    mac = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return "sha256=" + mac


def _wire_test_db(app, db_session, monkeypatch):
    """Route the handler's request session AND the BackgroundTask's
    transactional_session to the rolled-back test session, so the webhook's
    staging INSERT + background claim/dispatch never write to a DB outside the
    fixture (mirrors tests/test_pat_routes.py)."""
    @contextlib.asynccontextmanager
    async def _fake_txn():
        yield db_session

    async def _override_session():
        yield db_session  # db_session fixture owns the transaction/rollback

    monkeypatch.setattr(db_engine, "transactional_session", _fake_txn)
    app.dependency_overrides[db_engine.session] = _override_session


async def test_webhook_bad_signature_401(db_session, monkeypatch):
    import config
    monkeypatch.setattr(config, "GITHUB_WEBHOOK_SECRET", "topsecret", raising=False)
    import routers.github_webhook as gh
    importlib.reload(gh)
    app = FastAPI()
    app.include_router(gh.router, prefix="/api/github")
    _wire_test_db(app, db_session, monkeypatch)
    body = json.dumps({"action": "opened"}).encode()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        r = await ac.post("/api/github/webhook", content=body, headers={
            "X-Hub-Signature-256": "sha256=deadbeef",
            "X-GitHub-Event": "pull_request",
            "X-GitHub-Delivery": "d-badsig",
            "Content-Type": "application/json",
        })
    assert r.status_code == 401


async def test_webhook_valid_signature_returns_202(db_session, monkeypatch):
    import config
    monkeypatch.setattr(config, "GITHUB_WEBHOOK_SECRET", "topsecret", raising=False)
    import routers.github_webhook as gh
    importlib.reload(gh)
    app = FastAPI()
    app.include_router(gh.router, prefix="/api/github")
    _wire_test_db(app, db_session, monkeypatch)
    body = json.dumps({"action": "opened",
                       "repository": {"full_name": "org/repo"},
                       "pull_request": {"number": 1, "title": "x", "body": "",
                                        "head": {"ref": "f"}, "html_url": "u",
                                        "merged": False}}).encode()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        r = await ac.post("/api/github/webhook", content=body, headers={
            "X-Hub-Signature-256": _sign("topsecret", body),
            "X-GitHub-Event": "pull_request",
            "X-GitHub-Delivery": "d-valid-202",
            "Content-Type": "application/json",
        })
    assert r.status_code == 202


# --- idempotent-claim e2e tests -------------------------------------------
from core.model import github_webhook_event as event_model


async def test_duplicate_delivery_inserts_once(db_session):
    payload = {"action": "opened", "repository": {"full_name": "org/dup"},
               "pull_request": {"number": 1, "title": "x", "body": "",
                                "head": {"ref": "f"}, "html_url": "u", "merged": False}}
    first = await event_model.insert("dup-1", "pull_request", payload, db_session)
    second = await event_model.insert("dup-1", "pull_request", payload, db_session)
    assert first is not None
    assert second is None  # duplicate delivery -> no second row
    r = await db_session.execute(text(
        "SELECT COUNT(*) FROM github_webhook_event WHERE delivery_id = 'dup-1'"))
    assert r.scalar_one() == 1


async def test_claim_one_then_done_drains_single_event(db_session):
    # stage one event, claim it, mark done -> not claimable again
    payload = {"action": "opened", "repository": {"full_name": "org/cl"},
               "pull_request": {"number": 2, "title": "t", "body": "",
                                "head": {"ref": "f"}, "html_url": "u", "merged": False}}
    await event_model.insert("claim-1", "pull_request", payload, db_session)
    claimed = await event_model.claim_one(db_session)
    assert claimed is not None
    assert claimed["delivery_id"] == "claim-1"
    await event_model.mark_done(claimed["event_id"], db_session)
    again = await event_model.claim_one(db_session)
    assert again is None  # already done -> not re-claimed


# --- gate-consolidation tests (Slice 5 gate commit) -----------------------

async def test_find_by_key_row_excludes_archived(db_session):
    alice = await _make_user(db_session, "arch_fk@gh.test", "arch_fk")
    bid = await _make_branch(db_session, alice, key="ARCHK")
    await db_session.execute(text("UPDATE branch SET is_archived = TRUE WHERE branch_id = :b"), {"b": bid})
    assert await branch_model.find_by_key_row("ARCHK", db_session) is None


async def test_unknown_action_preserves_merged_ref_state(db_session):
    bid, tid, dn, _ = await _branch_with_task(db_session, "UNKA", "org/unka")
    merge_pl = _pr_payload("org/unka", "closed", True, 20, f"UNKA-{dn}", "", "f",
                           "https://github.com/org/unka/pull/20")
    await github_controller.dispatch_event("pull_request", merge_pl, db_session)
    assert await _ref_state(db_session, tid) == "merged"
    # a 'labeled' event on the same (now merged) PR must not downgrade state or move the task
    label_pl = _pr_payload("org/unka", "labeled", True, 20, f"UNKA-{dn}", "", "f",
                           "https://github.com/org/unka/pull/20")
    branch_ids = await github_controller.dispatch_event("pull_request", label_pl, db_session)
    assert await _ref_state(db_session, tid) == "merged"   # NOT downgraded to 'open'
    assert await _task_status(db_session, tid) == "done"
    assert bid in branch_ids                                # dispatch returns affected branches


async def test_unknown_action_synchronize_upserts_no_move(db_session):
    bid, tid, dn, _ = await _branch_with_task(db_session, "SYNC", "org/sync", status="in_progress")
    pl = _pr_payload("org/sync", "synchronize", False, 21, f"SYNC-{dn}", "", "f",
                     "https://github.com/org/sync/pull/21")
    await github_controller.dispatch_event("pull_request", pl, db_session)
    assert await _ref_state(db_session, tid) == "open"
    assert await _task_status(db_session, tid) == "in_progress"  # gate=None -> no move


async def test_dispatch_returns_affected_branch_ids(db_session):
    bid, tid, dn, _ = await _branch_with_task(db_session, "RETB", "org/retb")
    pl = _pr_payload("org/retb", "closed", True, 22, f"RETB-{dn}", "", "f",
                     "https://github.com/org/retb/pull/22")
    branch_ids = await github_controller.dispatch_event("pull_request", pl, db_session)
    assert branch_ids == [bid]
    # unconnected repo -> no affected branch
    empty = await github_controller.dispatch_event("pull_request",
        _pr_payload("org/none", "closed", True, 23, f"RETB-{dn}", "", "f",
                    "https://github.com/org/none/pull/23"), db_session)
    assert empty == []


async def test_dispatch_non_dict_payload_is_noop(db_session):
    assert await github_controller.dispatch_event("pull_request", None, db_session) == []


async def test_dispatch_without_system_bot_skips_transition(db_session):
    await db_session.execute(text('DELETE FROM "user" WHERE is_system = TRUE'))
    owner = await _make_user(db_session, "nobot@gh.test", "nobot")
    bid = await _make_branch(db_session, owner, key="NOBOT")
    await _add_member(db_session, bid, owner, "admin")
    tid, dn = await _make_task(db_session, bid, owner, status="in_progress")
    await _make_integration(db_session, bid, "org/nobot", 555, owner)
    pl = _pr_payload("org/nobot", "closed", True, 24, f"NOBOT-{dn}", "", "f",
                     "https://github.com/org/nobot/pull/24")
    await github_controller.dispatch_event("pull_request", pl, db_session)
    assert await _ref_state(db_session, tid) == "merged"          # ref still upserted
    assert await _task_status(db_session, tid) == "in_progress"   # NOT moved (no actor)
