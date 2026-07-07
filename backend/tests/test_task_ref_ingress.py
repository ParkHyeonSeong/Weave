"""Status/Type ref ingress tests — 해석 헬퍼, create 기본값, update alias.

Style: direct controller-function calls (no HTTP client), request via
SimpleNamespace, seed rows with raw sqlalchemy text() INSERTs
(test_controller_task_errors.py 컨벤션). status/type 시드는 기본값·alias
시나리오별 제어가 필요해 branch 시드와 분리돼 있다.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task as ctrl
from core.model import task_type_config as type_model
from core.model import workflow_status as ws_model
from routers.schema import task as schema


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(
        payload={'user_id': user_id, 'username': 'tester'}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Branch", key="TRI"):
    """Bare branch — status/type 시드는 각 테스트가 _add_status/_add_type으로."""
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    return row.scalar_one()


async def _add_status(db, branch_id, key, label, category="todo",
                      sort=0, is_default=False):
    row = await db.execute(text("""
        INSERT INTO workflow_status (branch_id, key, label, color, category,
                                     sort_order, is_default)
        VALUES (:b, :k, :l, '#9CA3AF', :c, :s, :d) RETURNING workflow_status_id
    """), {"b": branch_id, "k": key, "l": label, "c": category,
           "s": sort, "d": is_default})
    return row.scalar_one()


async def _add_type(db, branch_id, type_key, type_name, sort=0):
    row = await db.execute(text("""
        INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
        VALUES (:b, :k, :n, 'check', '#5E6AD2', :s) RETURNING type_id
    """), {"b": branch_id, "k": type_key, "n": type_name, "s": sort})
    return row.scalar_one()


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task_sequence(db, branch_id):
    await db.execute(text("""
        INSERT INTO task_sequence (branch_id, last_number)
        VALUES (:b, COALESCE((SELECT MAX(display_number) FROM task WHERE branch_id = :b), 0))
        ON CONFLICT (branch_id) DO UPDATE SET last_number = EXCLUDED.last_number
    """), {"b": branch_id})


async def _seed_standard(db, *, key="TRI"):
    """기본 시나리오: 시드 branch와 동일 (todo=is_default, 4 status / task=0번 type)."""
    uid = await _make_user(db, f"u_{key}@tri.test", f"u_{key}")
    bid = await _make_branch(db, uid, key=key)
    await _add_status(db, bid, "todo", "To Do", "todo", 0, True)
    await _add_status(db, bid, "in_progress", "In Progress", "in_progress", 1)
    await _add_status(db, bid, "done", "Done", "done", 2)
    await _add_status(db, bid, "cancelled", "Cancelled", "cancelled", 3)
    await _add_type(db, bid, "task", "Task", 0)
    await _add_type(db, bid, "bug", "Bug", 1)
    await _add_member(db, bid, uid, "admin")
    await _make_task_sequence(db, bid)
    return uid, bid


# ---------------------------------------------------------------------------
# Task 1: model helpers
# ---------------------------------------------------------------------------

async def test_find_default_prefers_is_default(db_session):
    uid = await _make_user(db_session, "fd1@tri.test", "fd1")
    bid = await _make_branch(db_session, uid, key="FD1")
    await _add_status(db_session, bid, "backlog", "Backlog", "todo", 0)
    await _add_status(db_session, bid, "doing", "Doing", "in_progress", 1, is_default=True)
    row = await ws_model.find_default(bid, db_session)
    assert row["key"] == "doing"


async def test_find_default_falls_back_to_first_sort_order(db_session):
    uid = await _make_user(db_session, "fd2@tri.test", "fd2")
    bid = await _make_branch(db_session, uid, key="FD2")
    await _add_status(db_session, bid, "later", "Later", "todo", 5)
    await _add_status(db_session, bid, "first", "First", "todo", 1)
    row = await ws_model.find_default(bid, db_session)
    assert row["key"] == "first"


async def test_find_default_empty_branch_returns_none(db_session):
    uid = await _make_user(db_session, "fd3@tri.test", "fd3")
    bid = await _make_branch(db_session, uid, key="FD3")
    assert await ws_model.find_default(bid, db_session) is None


async def test_find_first_type_by_sort_order(db_session):
    uid = await _make_user(db_session, "ff1@tri.test", "ff1")
    bid = await _make_branch(db_session, uid, key="FF1")
    await _add_type(db_session, bid, "story", "Story", 3)
    await _add_type(db_session, bid, "task", "Task", 0)
    row = await type_model.find_first(bid, db_session)
    assert row["type_key"] == "task"
    assert "type_id" in row  # create의 custom_fields 검증이 type_id를 씀


async def test_find_first_type_empty_branch_returns_none(db_session):
    uid = await _make_user(db_session, "ff2@tri.test", "ff2")
    bid = await _make_branch(db_session, uid, key="FF2")
    assert await type_model.find_first(bid, db_session) is None


# ---------------------------------------------------------------------------
# Task 2: resolve helpers
# ---------------------------------------------------------------------------

async def test_resolve_status_canonical_key_passes(db_session):
    uid, bid = await _seed_standard(db_session, key="RS1")
    row, err = await ctrl._resolve_status_ref(bid, "in_progress", db_session)
    assert err is None
    assert row["key"] == "in_progress"


async def test_resolve_status_key_case_and_whitespace_insensitive(db_session):
    uid, bid = await _seed_standard(db_session, key="RS2")
    row, err = await ctrl._resolve_status_ref(bid, "  In_Progress ", db_session)
    assert err is None
    assert row["key"] == "in_progress"


async def test_resolve_status_label_alias(db_session):
    uid, bid = await _seed_standard(db_session, key="RS3")
    row, err = await ctrl._resolve_status_ref(bid, "In Progress", db_session)
    assert err is None
    assert row["key"] == "in_progress"


async def test_resolve_status_ambiguous_label_hard_error(db_session):
    uid = await _make_user(db_session, "rs4@tri.test", "rs4")
    bid = await _make_branch(db_session, uid, key="RS4")
    await _add_status(db_session, bid, "review_a", "Review", "in_progress", 0)
    await _add_status(db_session, bid, "review_b", "Review", "in_progress", 1)
    row, err = await ctrl._resolve_status_ref(bid, "review", db_session)
    assert row is None
    assert err["code"] == "AMBIGUOUS_STATUS"
    assert err["category"] == "validation"
    assert {c["key"] for c in err["candidates"]} == {"review_a", "review_b"}


async def test_resolve_status_no_match_returns_valid_set(db_session):
    uid, bid = await _seed_standard(db_session, key="RS5")
    row, err = await ctrl._resolve_status_ref(bid, "nonexistent", db_session)
    assert row is None
    assert err["code"] == "INVALID_STATUS"
    assert [s["key"] for s in err["valid_statuses"]] == [
        "todo", "in_progress", "done", "cancelled"]  # sort_order 순
    assert all("label" in s for s in err["valid_statuses"])


async def test_resolve_status_empty_string_is_invalid(db_session):
    uid, bid = await _seed_standard(db_session, key="RS6")
    row, err = await ctrl._resolve_status_ref(bid, "   ", db_session)
    assert row is None
    assert err["code"] == "INVALID_STATUS"


async def test_resolve_type_key_case_insensitive_and_valid_set(db_session):
    """주의: "Bug"는 정규화("bug")가 key에 먼저 매칭되므로 key 경로다 —
    type_name 경로는 아래 distinct-paths 테스트가 별도 검증."""
    uid, bid = await _seed_standard(db_session, key="RT1")
    row, err = await ctrl._resolve_type_ref(bid, "Bug", db_session)
    assert err is None
    assert row["type_key"] == "bug"
    assert "type_id" in row

    row, err = await ctrl._resolve_type_ref(bid, "nope", db_session)
    assert row is None
    assert err["code"] == "INVALID_TASK_TYPE"
    assert [t["type_key"] for t in err["valid_task_types"]] == ["task", "bug"]
    assert all("type_name" in t for t in err["valid_task_types"])


async def test_resolve_type_key_ci_and_name_paths_are_distinct(db_session):
    """key와 type_name이 대소문자만 다르면 두 경로가 합쳐져 커버리지가 착시를
    일으킨다 — key에 underscore, name에 공백을 넣어 경로를 분리 검증."""
    uid = await _make_user(db_session, "rt3@tri.test", "rt3")
    bid = await _make_branch(db_session, uid, key="RT3")
    await _add_type(db_session, bid, "qa_bug", "QA Bug", 0)
    row, err = await ctrl._resolve_type_ref(bid, "QA_BUG", db_session)  # key ci 경로
    assert err is None
    assert row["type_key"] == "qa_bug"
    row, err = await ctrl._resolve_type_ref(bid, "QA Bug", db_session)  # name 경로
    assert err is None
    assert row["type_key"] == "qa_bug"


async def test_resolve_type_ambiguous_name_hard_error(db_session):
    uid = await _make_user(db_session, "rt2@tri.test", "rt2")
    bid = await _make_branch(db_session, uid, key="RT2")
    await _add_type(db_session, bid, "chore_a", "Chore", 0)
    await _add_type(db_session, bid, "chore_b", "Chore", 1)
    row, err = await ctrl._resolve_type_ref(bid, "chore", db_session)
    assert row is None
    assert err["code"] == "AMBIGUOUS_TASK_TYPE"
    # 후보 shape은 valid_task_types와 동일한 {type_key, type_name} — status의
    # {key, label}과 필드명이 다름에 주의
    assert {c["type_key"] for c in err["candidates"]} == {"chore_a", "chore_b"}
    assert all(c["type_name"] == "Chore" for c in err["candidates"])


async def test_resolve_type_empty_string_is_invalid(db_session):
    uid, bid = await _seed_standard(db_session, key="RS7")
    row, err = await ctrl._resolve_type_ref(bid, "   ", db_session)
    assert row is None
    assert err["code"] == "INVALID_TASK_TYPE"


async def test_resolve_blank_label_never_matches_empty_input(db_session):
    """admin이 label을 공백으로 만들어도 빈 입력이 그 status로 조용히
    해석되면 안 된다 (최종 리뷰 finding — normalized 빈 값 선차단)."""
    uid = await _make_user(db_session, "rs8@tri.test", "rs8")
    bid = await _make_branch(db_session, uid, key="RS8")
    await _add_status(db_session, bid, "ghost", "   ", "todo", 0)
    row, err = await ctrl._resolve_status_ref(bid, "   ", db_session)
    assert row is None
    assert err["code"] == "INVALID_STATUS"


# ---------------------------------------------------------------------------
# Task 3: column width — config key(50자 유효)와 task 컬럼(20자) 정합
# ---------------------------------------------------------------------------

async def _get_task_row(db, task_id):
    row = await db.execute(text(
        "SELECT status, task_type FROM task WHERE task_id = :t"), {"t": task_id})
    return dict(row.fetchone()._mapping)


async def test_create_with_long_config_key_succeeds(db_session):
    """config key는 50자까지 유효한데 task.status/task_type이 String(20)이라
    21자+ key가 현행도 DBAPIError 500으로 죽는 정합 버그 — widen 후 성공 고정.
    (명시 경로·GitHub 전이 경로·이후 추가될 기본값 경로가 전부 같은 컬럼.)"""
    long_status = "status_" + "x" * 18   # 25자
    long_type = "type_" + "y" * 18       # 23자
    uid = await _make_user(db_session, "lk1@tri.test", "lk1")
    bid = await _make_branch(db_session, uid, key="LK1")
    await _add_status(db_session, bid, long_status, "Long Status", "todo", 0, True)
    await _add_type(db_session, bid, long_type, "Long Type", 0)
    await _add_member(db_session, bid, uid)
    await _make_task_sequence(db_session, bid)
    res = await ctrl.create(
        schema.TaskCreate(title="T", status=long_status, task_type=long_type),
        bid, _req(uid), db_session)
    assert res["status"] is True
    saved = await _get_task_row(db_session, res["task_id"])
    assert saved == {"status": long_status, "task_type": long_type}


# ---------------------------------------------------------------------------
# Task 4: create() — defaults, alias, applied_* echo (_get_task_row는 Task 3에서 정의)
# ---------------------------------------------------------------------------

async def test_create_omitted_uses_seeded_defaults(db_session):
    uid, bid = await _seed_standard(db_session, key="CR1")
    body = schema.TaskCreate(title="T1")
    res = await ctrl.create(body, bid, _req(uid), db_session)
    assert res["status"] is True
    assert res["applied_status"] == "todo"
    assert res["applied_task_type"] == "task"
    saved = await _get_task_row(db_session, res["task_id"])
    assert saved == {"status": "todo", "task_type": "task"}


async def test_create_omitted_status_follows_is_default(db_session):
    uid = await _make_user(db_session, "cr2@tri.test", "cr2")
    bid = await _make_branch(db_session, uid, key="CR2")
    await _add_status(db_session, bid, "backlog", "Backlog", "todo", 0)
    await _add_status(db_session, bid, "triage", "Triage", "todo", 1, is_default=True)
    await _add_type(db_session, bid, "task", "Task", 0)
    await _add_member(db_session, bid, uid)
    await _make_task_sequence(db_session, bid)
    res = await ctrl.create(schema.TaskCreate(title="T"), bid, _req(uid), db_session)
    assert res["status"] is True
    assert res["applied_status"] == "triage"


async def test_create_omitted_status_without_todo_key_succeeds(db_session):
    """현재 하드코딩('todo')에서는 실패하는 케이스 — branch에 todo가 없어도 생성 성공."""
    uid = await _make_user(db_session, "cr3@tri.test", "cr3")
    bid = await _make_branch(db_session, uid, key="CR3")
    await _add_status(db_session, bid, "open", "Open", "todo", 0)
    await _add_type(db_session, bid, "issue", "Issue", 0)
    await _add_member(db_session, bid, uid)
    await _make_task_sequence(db_session, bid)
    res = await ctrl.create(schema.TaskCreate(title="T"), bid, _req(uid), db_session)
    assert res["status"] is True
    assert res["applied_status"] == "open"
    assert res["applied_task_type"] == "issue"


async def test_create_with_label_alias_stores_canonical_key(db_session):
    uid, bid = await _seed_standard(db_session, key="CR4")
    body = schema.TaskCreate(title="T", status="In Progress", task_type="Bug")
    res = await ctrl.create(body, bid, _req(uid), db_session)
    assert res["status"] is True
    saved = await _get_task_row(db_session, res["task_id"])
    assert saved == {"status": "in_progress", "task_type": "bug"}


async def test_create_invalid_status_no_task_created(db_session):
    uid, bid = await _seed_standard(db_session, key="CR5")
    res = await ctrl.create(
        schema.TaskCreate(title="T", status="nope"), bid, _req(uid), db_session)
    assert res["status"] is False
    assert res["code"] == "INVALID_STATUS"
    assert len(res["valid_statuses"]) == 4
    count = await db_session.execute(text(
        "SELECT COUNT(*) FROM task WHERE branch_id = :b"), {"b": bid})
    assert count.scalar_one() == 0


async def test_create_ambiguous_status_label(db_session):
    uid = await _make_user(db_session, "cr6@tri.test", "cr6")
    bid = await _make_branch(db_session, uid, key="CR6")
    await _add_status(db_session, bid, "rev_a", "Review", "in_progress", 0)
    await _add_status(db_session, bid, "rev_b", "Review", "in_progress", 1)
    await _add_type(db_session, bid, "task", "Task", 0)
    await _add_member(db_session, bid, uid)
    await _make_task_sequence(db_session, bid)
    res = await ctrl.create(
        schema.TaskCreate(title="T", status="Review"), bid, _req(uid), db_session)
    assert res["status"] is False
    assert res["code"] == "AMBIGUOUS_STATUS"


async def test_create_omitted_status_on_branch_without_statuses_stays_200(db_session):
    """실제 restore edge: 마이그레이션 024만 아카이브 branch를 workflow_status
    시딩에서 제외했고(010의 task_type 시딩은 전 branch 무필터) restore는
    재시딩하지 않으므로, status 0건 branch가 실존 가능하다. find_default가
    None일 때 역참조 500이 아니라 기존과 동일한 200 에러 계약을 유지."""
    uid = await _make_user(db_session, "cr8@tri.test", "cr8")
    bid = await _make_branch(db_session, uid, key="CR8")
    await _add_type(db_session, bid, "task", "Task", 0)
    # workflow_status는 의도적으로 0건 — 024 당시 아카이브였다 복원된 branch 재현
    await _add_member(db_session, bid, uid)
    await _make_task_sequence(db_session, bid)
    res = await ctrl.create(schema.TaskCreate(title="T"), bid, _req(uid), db_session)
    assert res["status"] is False
    assert res["code"] == "INVALID_STATUS"
    assert res["valid_statuses"] == []


async def test_create_omitted_type_on_branch_without_types_stays_200(db_session):
    """type 0건은 마이그레이션 유래로는 발생하지 않지만(010이 전 branch 시딩)
    find_first 가드의 200 계약을 대칭으로 고정하는 순수 방어 테스트."""
    uid = await _make_user(db_session, "cr9@tri.test", "cr9")
    bid = await _make_branch(db_session, uid, key="CR9")
    await _add_status(db_session, bid, "todo", "To Do", "todo", 0, True)
    # task_type은 의도적으로 0건
    await _add_member(db_session, bid, uid)
    await _make_task_sequence(db_session, bid)
    res = await ctrl.create(schema.TaskCreate(title="T"), bid, _req(uid), db_session)
    assert res["status"] is False
    assert res["code"] == "INVALID_TASK_TYPE"
    assert res["valid_task_types"] == []


async def test_create_mention_prefix_uses_resolved_type(db_session):
    """멘션 prefix가 raw alias가 아닌 canonical key 대문자를 쓰는지 (BUG-n 형식).

    멘션 문법은 extract_mention_user_ids(library/mention_parser.py) 기준 —
    HTML의 data-user-id 속성.
    """
    uid, bid = await _seed_standard(db_session, key="CR7")
    other = await _make_user(db_session, "cr7b@tri.test", "cr7b")
    await _add_member(db_session, bid, other)
    body = schema.TaskCreate(
        title="T", task_type="Bug",  # alias — canonical은 'bug'
        description=f'<span data-user-id="{other}">@cr7b</span> 확인')
    res = await ctrl.create(body, bid, _req(uid), db_session)
    assert res["status"] is True
    row = await db_session.execute(text("""
        SELECT title FROM notification
        WHERE user_id = :u ORDER BY notification_id DESC LIMIT 1
    """), {"u": other})
    title = row.scalar_one()
    assert f"BUG-{res['display_number']}" in title


# ---------------------------------------------------------------------------
# Task 5: update() — alias resolution
# ---------------------------------------------------------------------------

async def _create_task(db, uid, bid, **kwargs):
    res = await ctrl.create(schema.TaskCreate(title="Seed", **kwargs), bid, _req(uid), db)
    assert res["status"] is True
    return res["task_id"]


async def test_update_status_alias_stores_canonical(db_session):
    uid, bid = await _seed_standard(db_session, key="UP1")
    tid = await _create_task(db_session, uid, bid)
    res = await ctrl.update(
        tid, schema.TaskUpdate(status="DONE"), bid, _req(uid), db_session)
    assert res["status"] is True
    saved = await _get_task_row(db_session, tid)
    assert saved["status"] == "done"


async def test_update_type_label_alias_stores_canonical(db_session):
    uid, bid = await _seed_standard(db_session, key="UP2")
    tid = await _create_task(db_session, uid, bid)
    res = await ctrl.update(
        tid, schema.TaskUpdate(task_type="Bug"), bid, _req(uid), db_session)
    assert res["status"] is True
    saved = await _get_task_row(db_session, tid)
    assert saved["task_type"] == "bug"


async def test_update_invalid_status_returns_valid_set(db_session):
    uid, bid = await _seed_standard(db_session, key="UP3")
    tid = await _create_task(db_session, uid, bid)
    res = await ctrl.update(
        tid, schema.TaskUpdate(status="nope"), bid, _req(uid), db_session)
    assert res["status"] is False
    assert res["code"] == "INVALID_STATUS"
    assert len(res["valid_statuses"]) == 4
    saved = await _get_task_row(db_session, tid)
    assert saved["status"] == "todo"  # 무변경


async def test_update_dry_run_previews_canonical_key(db_session):
    """dry_run diff shape은 _build_dry_run_preview 기준:
    changes['fields'][k] = {'from': ..., 'to': ...}"""
    uid, bid = await _seed_standard(db_session, key="UP4")
    tid = await _create_task(db_session, uid, bid)
    res = await ctrl.update(
        tid, schema.TaskUpdate(status="In Progress", dry_run=True),
        bid, _req(uid), db_session)
    assert res["status"] is True and res["dry_run"] is True
    assert res["changes"]["fields"]["status"] == {"from": "todo", "to": "in_progress"}
    saved = await _get_task_row(db_session, tid)
    assert saved["status"] == "todo"  # dry_run은 무저장


async def test_update_type_alias_with_custom_fields_uses_resolved_row(db_session):
    """task_type alias + custom_fields 동시 지정 — 검증이 resolved row(type_id)로
    수행되는지. 재사용이 깨져 raw alias 'Bug'로 find_by_key 하면
    INVALID_TASK_TYPE이 나와 버리므로, INVALID_CUSTOM_FIELD가 나오는 것이
    resolved row 경유의 증거."""
    uid, bid = await _seed_standard(db_session, key="UP5")
    tid = await _create_task(db_session, uid, bid)
    bug_type = await type_model.find_by_key(bid, "bug", db_session)
    row = await db_session.execute(text("""
        INSERT INTO custom_field (type_id, field_name, field_type, is_required, sort_order)
        VALUES (:t, 'points', 'number', false, 0) RETURNING custom_field_id
    """), {"t": bug_type["type_id"]})
    fid = row.scalar_one()
    res = await ctrl.update(
        tid, schema.TaskUpdate(task_type="Bug",
                               custom_fields={str(fid): "not-a-number"}),
        bid, _req(uid), db_session)
    assert res["status"] is False
    assert res["code"] == "INVALID_CUSTOM_FIELD"


async def test_update_explicit_null_status_rejected(db_session):
    """explicit null은 검증 우회 후 NOT NULL 컬럼 UPDATE로 500이 나던 경로 —
    빈 문자열과 동일하게 INVALID_STATUS로 거부한다.
    (kwarg로 None을 넘기면 model_fields_set에 남아 exclude_unset을 통과.)"""
    uid, bid = await _seed_standard(db_session, key="UP6")
    tid = await _create_task(db_session, uid, bid)
    res = await ctrl.update(
        tid, schema.TaskUpdate(status=None), bid, _req(uid), db_session)
    assert res["status"] is False
    assert res["code"] == "INVALID_STATUS"
    assert len(res["valid_statuses"]) == 4
    saved = await _get_task_row(db_session, tid)
    assert saved["status"] == "todo"  # 무변경


async def test_update_explicit_null_task_type_rejected(db_session):
    uid, bid = await _seed_standard(db_session, key="UP7")
    tid = await _create_task(db_session, uid, bid)
    res = await ctrl.update(
        tid, schema.TaskUpdate(task_type=None), bid, _req(uid), db_session)
    assert res["status"] is False
    assert res["code"] == "INVALID_TASK_TYPE"
    saved = await _get_task_row(db_session, tid)
    assert saved["task_type"] == "task"  # 무변경
