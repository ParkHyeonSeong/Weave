from fastmcp import Client

from weave_mcp import _app


async def test_list_sprints(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_sprints", {"branch_id": 1})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches/1/sprints")


async def test_create_sprint(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("create_sprint", {"branch_id": 1, "sprint_name": "S1"})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/sprints", json={"sprint_name": "S1"}
    )


async def test_update_sprint(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_sprint", {"branch_id": 1, "sprint_id": 2, "goal": "Ship it"}
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/branches/1/sprints/2", json={"goal": "Ship it"}
    )


async def test_delete_sprint(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("delete_sprint", {"branch_id": 1, "sprint_id": 2})
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/branches/1/sprints/2"
    )


async def test_start_sprint(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("start_sprint", {"branch_id": 1, "sprint_id": 2})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/sprints/2/start"
    )


async def test_complete_sprint(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("complete_sprint", {"branch_id": 1, "sprint_id": 2})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/sprints/2/complete", json={"move_to": "backlog"}
    )
