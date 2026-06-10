from fastmcp import Client

from weave_mcp import _app


async def test_get_current_user(fake_client):
    fake_client.call_json.return_value = {"status": True, "profile": {"user_id": 1}}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_current_user", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/auth/me")


async def test_list_branches(fake_client):
    fake_client.call_json.return_value = [{"id": 1, "name": "Core"}]
    async with Client(_app.mcp) as client:
        await client.call_tool("list_branches", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches")


async def test_get_branch_home_stats(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_branch_home_stats", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches/home-stats")


async def test_list_my_tasks_filters(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("list_my_tasks", {"status": "todo", "branch_id": 2})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/my-tasks", params={"status": "todo", "branch_id": 2}
    )


async def test_get_task(fake_client):
    fake_client.call_json.return_value = {"id": 5}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_task", {"branch_id": 3, "task_id": 5})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches/3/tasks/5")


async def test_create_task_sends_body(fake_client):
    fake_client.call_json.return_value = {"id": 10}
    async with Client(_app.mcp) as client:
        await client.call_tool("create_task", {"branch_id": 3, "title": "New", "priority": "high"})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/3/tasks", json={"title": "New", "priority": "high"}
    )


async def test_add_task_comment(fake_client):
    fake_client.call_json.return_value = {"id": 99}
    async with Client(_app.mcp) as client:
        await client.call_tool("add_task_comment", {"branch_id": 3, "task_id": 5, "content": "hi"})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/3/tasks/5/comments", json={"content": "hi"}
    )
