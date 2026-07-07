"""User-ref ingress: resolve_user_refs 단위 + 미들웨어 통합 + 레지스트리↔스키마 sweep.
See docs/superpowers/specs/2026-07-07-user-ref-ingress-design.md."""
from unittest.mock import AsyncMock

from fastmcp import Client

from weave_mcp import _app
from weave_mcp import errors as E
from weave_mcp._user_ref import USER_REF_PARAMS, resolve_user_refs

MEMBERS_BODY = {"status": True, "members": [
    {"user_id": 3, "username": "김철수", "email": "kim@x.com", "role": "member"},
    {"user_id": 5, "username": "박영희", "email": "park@x.com", "role": "admin"},
    {"user_id": 7, "username": "dup", "email": "dup1@x.com", "role": "member"},
    {"user_id": 8, "username": "dup", "email": "dup2@x.com", "role": "member"},
]}
ME_BODY = {"status": True, "profile": {"user_id": 42, "email": "me@x.com",
                                       "username": "나", "role": "member"}}


def _client(*bodies):
    c = AsyncMock()
    c.call_json.side_effect = list(bodies)
    return c


async def test_all_int_args_make_no_http_calls():
    client = AsyncMock()
    args = {"branch_id": 1, "title": "x", "assignee_main": 3, "assignee_sub": [5, 8]}
    assert await resolve_user_refs("create_task", args, client) is None
    client.call_json.assert_not_awaited()
    assert args["assignee_main"] == 3 and args["assignee_sub"] == [5, 8]


async def test_digit_string_becomes_int_without_http():
    client = AsyncMock()
    args = {"branch_id": 1, "task_id": 9, "user_id": "12"}
    assert await resolve_user_refs("add_task_assignee", args, client) is None
    client.call_json.assert_not_awaited()
    assert args["user_id"] == 12


async def test_username_resolves_via_single_members_fetch():
    client = _client(MEMBERS_BODY)
    args = {"branch_id": 1, "assignee_main": "김철수", "assignee_sub": ["박영희"]}
    assert await resolve_user_refs("create_task", args, client) is None
    client.call_json.assert_awaited_once_with("GET", "/api/branches/1/members")
    assert args["assignee_main"] == 3 and args["assignee_sub"] == [5]


async def test_email_matches_case_insensitive():
    client = _client(MEMBERS_BODY)
    args = {"branch_id": 1, "assignee_main": "KIM@X.com"}
    assert await resolve_user_refs("create_task", args, client) is None
    assert args["assignee_main"] == 3


async def test_me_and_dollar_me_resolve_via_auth_me():
    client = _client(ME_BODY)
    args = {"branch_id": 1, "participant_ids": ["me", "$me"]}
    assert await resolve_user_refs("create_schedule_event", args, client) is None
    client.call_json.assert_awaited_once_with("GET", "/api/auth/me")
    assert args["participant_ids"] == [42, 42]


async def test_mixed_list_fetches_members_then_me():
    client = _client(MEMBERS_BODY, ME_BODY)
    args = {"branch_id": 1, "task_id": 9, "assignee_sub": [3, "박영희", "me"]}
    assert await resolve_user_refs("update_task", args, client) is None
    calls = client.call_json.await_args_list
    assert calls[0].args == ("GET", "/api/branches/1/members")
    assert calls[1].args == ("GET", "/api/auth/me")
    assert args["assignee_sub"] == [3, 5, 42]


async def test_ambiguous_username_fails_with_candidates_and_no_mutation():
    client = _client(MEMBERS_BODY)
    args = {"branch_id": 1, "task_id": 9, "assignee_sub": [3, "dup"]}
    err = await resolve_user_refs("update_task", args, client)
    assert err["error"]["code"] == "USER_REF_AMBIGUOUS"
    assert err["error"]["category"] == "validation"
    assert {c["user_id"] for c in err["error"]["detail"]} == {7, 8}
    assert "assignee_sub[1]" in err["error"]["message"]
    assert args["assignee_sub"] == [3, "dup"]  # 원자성: 실패 시 무변경


async def test_case_variant_duplicate_emails_are_ambiguous():
    """email unique 제약은 case-sensitive(일반 String unique, 입력 lower-정규화 없음)라
    Alice@x/alice@x가 별개 계정으로 공존 가능 — ci 매칭이 2건을 만나면 hard error."""
    dup_email_body = {"status": True, "members": [
        {"user_id": 11, "username": "a", "email": "Alice@x.com", "role": "member"},
        {"user_id": 12, "username": "b", "email": "alice@x.com", "role": "member"},
    ]}
    client = _client(dup_email_body)
    args = {"branch_id": 1, "assignee_main": "ALICE@x.com"}
    err = await resolve_user_refs("create_task", args, client)
    assert err["error"]["code"] == "USER_REF_AMBIGUOUS"
    assert {c["user_id"] for c in err["error"]["detail"]} == {11, 12}
    assert args["assignee_main"] == "ALICE@x.com"  # 원자성: 무변경


async def test_unknown_ref_is_not_found():
    client = _client(MEMBERS_BODY)
    args = {"branch_id": 1, "assignee_main": "없는사람"}
    err = await resolve_user_refs("create_task", args, client)
    assert err["error"]["code"] == "USER_REF_NOT_FOUND"
    assert err["error"]["category"] == "not_found"


async def test_blank_string_is_invalid_without_http():
    client = AsyncMock()
    args = {"branch_id": 1, "assignee_main": "  "}
    err = await resolve_user_refs("create_task", args, client)
    assert err["error"]["code"] == "INVALID_USER_REF"
    client.call_json.assert_not_awaited()


async def test_members_fetch_error_propagates_unchanged():
    boom = E.make_error("network", message="down")
    client = _client(boom)
    args = {"branch_id": 1, "assignee_main": "김철수"}
    assert await resolve_user_refs("create_task", args, client) is boom
    assert args["assignee_main"] == "김철수"


async def test_unregistered_tool_is_untouched():
    client = AsyncMock()
    args = {"branch_id": 1, "user_id": "김철수"}
    assert await resolve_user_refs("add_branch_member", args, client) is None
    client.call_json.assert_not_awaited()
    assert args["user_id"] == "김철수"


def test_middleware_relative_order_pinned():
    """등록 순서가 곧 실행 순서(바깥→안)다 — FastMCP `_run_middleware`는
    reversed(self.middleware)로 체인을 감싸므로 먼저 등록된 것이 outermost.
    UserRefResolver가 BranchRefResolver보다 앞(바깥)에 오면 branch key("WV")가
    numeric으로 해석되기 전에 /api/branches/WV/members 조회가 나간다.
    기존 테스트는 존재만 확인하므로(any isinstance) 여기서 상대 순서를 고정한다."""
    from weave_mcp._middleware import WeaveDriftGuard, BranchRefResolver, UserRefResolver
    kinds = [type(m) for m in _app.mcp.middleware]
    assert (kinds.index(WeaveDriftGuard)
            < kinds.index(BranchRefResolver)
            < kinds.index(UserRefResolver))


async def test_create_task_username_resolved_before_post(fake_client):
    fake_client.call_json.side_effect = [MEMBERS_BODY, {"task_id": 1}]
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "create_task", {"branch_id": 1, "title": "x", "assignee_main": "김철수"})
    calls = fake_client.call_json.await_args_list
    assert calls[0].args == ("GET", "/api/branches/1/members")
    assert calls[1].args[:2] == ("POST", "/api/branches/1/tasks")
    assert calls[1].kwargs["json"]["assignees"] == {"main": 3}


async def test_create_task_int_assignees_skip_member_lookup(fake_client):
    fake_client.call_json.return_value = {"task_id": 1}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "create_task", {"branch_id": 1, "title": "x", "assignee_main": 3})
    fake_client.call_json.assert_awaited_once()


async def test_remove_task_assignee_resolves_into_url_path(fake_client):
    fake_client.call_json.side_effect = [MEMBERS_BODY, {"status": True}]
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "remove_task_assignee", {"branch_id": 1, "task_id": 9, "user_id": "박영희"})
    calls = fake_client.call_json.await_args_list
    assert calls[1].args == ("DELETE", "/api/branches/1/tasks/9/assignees/5")


async def test_ambiguous_username_short_circuits_without_post(fake_client):
    fake_client.call_json.return_value = MEMBERS_BODY
    async with Client(_app.mcp) as client:
        result = await client.call_tool(
            "update_task", {"branch_id": 1, "task_id": 9, "assignee_main": "dup"})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches/1/members")
    assert result.structured_content["error"]["code"] == "USER_REF_AMBIGUOUS"


async def test_schedule_me_participant(fake_client):
    fake_client.call_json.side_effect = [ME_BODY, {"event_id": 1}]
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "create_schedule_event",
            {"branch_id": 1, "title": "t", "start_date": "2026-07-07",
             "participant_ids": ["me"]})
    calls = fake_client.call_json.await_args_list
    assert calls[0].args == ("GET", "/api/auth/me")
    assert calls[1].kwargs["json"]["participant_ids"] == [42]


async def test_add_task_assignee_username_in_body(fake_client):
    fake_client.call_json.side_effect = [MEMBERS_BODY, {"status": True}]
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "add_task_assignee",
            {"branch_id": 1, "task_id": 9, "user_id": "김철수", "role": "main"})
    calls = fake_client.call_json.await_args_list
    assert calls[1].args[:2] == ("POST", "/api/branches/1/tasks/9/assignees")
    assert calls[1].kwargs["json"] == {"user_id": 3, "role": "main"}


async def test_update_schedule_event_email_participant(fake_client):
    fake_client.call_json.side_effect = [MEMBERS_BODY, {"status": True}]
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_schedule_event",
            {"branch_id": 1, "event_id": 4, "participant_ids": ["park@x.com", 3]})
    calls = fake_client.call_json.await_args_list
    assert calls[1].args[:2] == ("PATCH", "/api/branches/1/schedule-events/4")
    assert calls[1].kwargs["json"]["participant_ids"] == [5, 3]


async def test_branch_key_and_username_compose(fake_client):
    """BranchRefResolver가 먼저 실행돼 branch_id가 numeric이 된 뒤 멤버 조회가 일어난다."""
    fake_client.call_json.side_effect = [
        {"status": True, "branches": [{"branch_id": 7, "key": "WV"}]},
        MEMBERS_BODY, {"task_id": 1},
    ]
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "create_task", {"branch_id": "WV", "title": "x", "assignee_main": "김철수"})
    calls = fake_client.call_json.await_args_list
    assert calls[0].args == ("GET", "/api/branches")
    assert calls[1].args == ("GET", "/api/branches/7/members")
    assert calls[2].args[:2] == ("POST", "/api/branches/7/tasks")


def _accepted_types(prop):
    """JSON-schema types a property accepts, flattening anyOf and array items."""
    out = set()

    def walk(s):
        for sub in s.get("anyOf", []):
            walk(sub)
        t = s.get("type")
        if t == "array":
            walk(s.get("items", {}))
        elif isinstance(t, str):
            out.add(t)
        elif isinstance(t, list):
            out.update(t)

    walk(prop)
    return out


async def test_registry_params_advertise_integer_and_string():
    """USER_REF_PARAMS의 모든 (tool, param)이 integer+string을 광고해야 한다(리스트는
    items 기준) — 레지스트리↔스키마 드리프트 방지. 새 도구를 레지스트리에 넣고
    어노테이션 확장을 빠뜨리면 여기서 잡힌다."""
    async with Client(_app.mcp) as client:
        tools = {t.name: t for t in await client.list_tools()}
    offenders = []
    for tool_name, spec in USER_REF_PARAMS.items():
        props = (tools[tool_name].inputSchema or {}).get("properties", {})
        for param in (*spec.scalars, *spec.lists):
            accepted = _accepted_types(props[param])
            if not ({"integer", "string"} <= accepted):
                offenders.append((tool_name, param, sorted(accepted)))
    assert not offenders, f"user-ref params not widened to int|str: {offenders}"
