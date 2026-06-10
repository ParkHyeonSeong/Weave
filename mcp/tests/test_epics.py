from fastmcp import Client

from weave_mcp import _app


async def test_list_epics(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_epics", {"branch_id": 1})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches/1/epics")


async def test_get_epic(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_epic", {"branch_id": 1, "epic_id": 3})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches/1/epics/3")


async def test_create_epic(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("create_epic", {"branch_id": 1, "epic_name": "E1"})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/epics", json={"epic_name": "E1"}
    )


async def test_update_epic(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_epic", {"branch_id": 1, "epic_id": 3, "color": "#5E6AD2"}
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/branches/1/epics/3", json={"color": "#5E6AD2"}
    )


async def test_delete_epic(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("delete_epic", {"branch_id": 1, "epic_id": 3})
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/branches/1/epics/3"
    )


async def test_list_epic_tasks(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("list_epic_tasks", {"branch_id": 1, "epic_id": 3})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/1/epics/3/tasks"
    )
