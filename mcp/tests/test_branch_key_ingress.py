from fastmcp import Client

from weave_mcp import _app


def _accepts(schema):
    """Collect the JSON-schema types a property accepts (handles anyOf and type-list)."""
    out = set()
    if "anyOf" in schema:
        for sub in schema["anyOf"]:
            t = sub.get("type")
            if isinstance(t, str):
                out.add(t)
    t = schema.get("type")
    if isinstance(t, str):
        out.add(t)
    elif isinstance(t, list):
        out.update(t)
    return out


async def test_create_task_schema_accepts_key_and_id():
    async with Client(_app.mcp) as client:
        tools = await client.list_tools()
    schema = next(t for t in tools if t.name == "create_task").inputSchema
    accepted = _accepts(schema["properties"]["branch_id"])
    assert "string" in accepted and "integer" in accepted


async def test_key_resolves_end_to_end(fake_client):
    # 1st call: list_branches lookup; 2nd call: the actual task POST against resolved id.
    fake_client.call_json.side_effect = [
        {"status": True, "branches": [{"branch_id": 7, "key": "WV", "branch_name": "Weave"}]},
        {"task_id": 1},
    ]
    async with Client(_app.mcp) as client:
        await client.call_tool("create_task", {"branch_id": "WV", "title": "x"})
    calls = fake_client.call_json.await_args_list
    assert calls[0].args == ("GET", "/api/branches")
    assert calls[1].args[:2] == ("POST", "/api/branches/7/tasks")


async def test_int_branch_id_skips_lookup(fake_client):
    fake_client.call_json.return_value = {"task_id": 1}
    async with Client(_app.mcp) as client:
        await client.call_tool("create_task", {"branch_id": 7, "title": "x"})
    fake_client.call_json.assert_awaited_once()  # no list_branches resolution call
    assert fake_client.call_json.await_args.args[:2] == ("POST", "/api/branches/7/tasks")


async def test_unknown_key_returns_not_found_without_post(fake_client):
    fake_client.call_json.return_value = {"status": True, "branches": []}
    async with Client(_app.mcp) as client:
        result = await client.call_tool("create_task", {"branch_id": "ZZ", "title": "x"})
    # only the resolution lookup happened — no POST
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches")
    assert result.structured_content["error"]["code"] == "BRANCH_KEY_NOT_FOUND"


async def test_all_branch_id_params_advertise_string_in_schema():
    """SCHEMA-level invariant only (not resolution): no tool may advertise an
    integer-only `branch_id`, since the resolver relies on the schema accepting a
    string. Guards against a tool file the widening missed. (Whether a given key
    resolves is member-scoped and tested separately.)"""
    async with Client(_app.mcp) as client:
        tools = await client.list_tools()
    offenders = []
    for t in tools:
        props = (t.inputSchema or {}).get("properties", {})
        if "branch_id" in props:
            accepted = _accepts(props["branch_id"])
            if not ({"string", "integer"} <= accepted):
                offenders.append((t.name, sorted(accepted)))
    assert not offenders, f"branch_id not widened to int|str on: {offenders}"
