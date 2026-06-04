from fastmcp import Client

from weave_mcp import _app


async def test_list_branch_tasks_no_sprint(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("list_branch_tasks", {"branch_id": 3})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/3/tasks", params={}
    )


async def test_list_branch_tasks_with_sprint(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("list_branch_tasks", {"branch_id": 3, "sprint_id": 7})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/3/tasks", params={"sprint_id": 7}
    )


async def test_update_task(fake_client):
    fake_client.call_json.return_value = {"id": 5}
    async with Client(_app.mcp) as client:
        await client.call_tool("update_task", {"branch_id": 3, "task_id": 5, "status": "done"})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/branches/3/tasks/5", json={"status": "done"}
    )


async def test_delete_task(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("delete_task", {"branch_id": 3, "task_id": 5})
    fake_client.call_json.assert_awaited_once_with("DELETE", "/api/branches/3/tasks/5")


async def test_list_task_comments(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("list_task_comments", {"branch_id": 3, "task_id": 5})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/3/tasks/5/comments"
    )


async def test_update_task_comment(fake_client):
    fake_client.call_json.return_value = {"id": 9}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_task_comment",
            {"branch_id": 3, "task_id": 5, "comment_id": 9, "content": "updated"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH",
        "/api/branches/3/tasks/5/comments/9",
        json={"content": "updated"},
    )


async def test_delete_task_comment(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "delete_task_comment",
            {"branch_id": 3, "task_id": 5, "comment_id": 9},
        )
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/branches/3/tasks/5/comments/9"
    )
