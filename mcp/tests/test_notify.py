from fastmcp import Client

from weave_mcp import _app


async def test_list_notifications(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_notifications", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/notifications", params={})


async def test_list_notifications_paginated(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_notifications", {"limit": 50, "offset": 50})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/notifications", params={"limit": 50, "offset": 50}
    )


async def test_get_unread_notification_count(fake_client):
    fake_client.call_json.return_value = {"status": True, "count": 3}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_unread_notification_count", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/notifications/unread-count")


async def test_mark_all_notifications_read(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("mark_all_notifications_read", {})
    fake_client.call_json.assert_awaited_once_with("PATCH", "/api/notifications/read-all")


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


async def test_toggle_star(fake_client):
    fake_client.call_json.return_value = {"status": True, "starred": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("toggle_star", {"item_type": "task", "item_id": 42})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/stars", json={"item_type": "task", "item_id": 42}
    )


async def test_check_starred(fake_client):
    fake_client.call_json.return_value = {"status": True, "starred": False}
    async with Client(_app.mcp) as client:
        await client.call_tool("check_starred", {"item_type": "doc", "item_id": 8})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/stars/check", params={"item_type": "doc", "item_id": 8}
    )
