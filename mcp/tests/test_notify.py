from fastmcp import Client

from weave_mcp import _app


async def test_list_notifications(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_notifications", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/notifications")


async def test_mark_notification_read(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("mark_notification_read", {"notification_id": 9})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/notifications/9/read"
    )


async def test_list_starred_with_type(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_starred", {"item_type": "task"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/stars", params={"type": "task"}
    )


async def test_list_starred_no_filter(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_starred", {})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/stars", params={}
    )
