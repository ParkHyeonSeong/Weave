from fastmcp import Client

from weave_mcp import _app


async def test_list_task_issues(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("list_task_issues", {"branch_id": 1, "task_id": 2})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/1/tasks/2/issues"
    )


async def test_get_task_issue(fake_client):
    fake_client.call_json.return_value = {"id": 3}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_task_issue", {"branch_id": 1, "task_id": 2, "issue_id": 3})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/1/tasks/2/issues/3"
    )


async def test_create_task_issue_required_only(fake_client):
    fake_client.call_json.return_value = {"id": 10}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "create_task_issue", {"branch_id": 1, "task_id": 2, "title": "Bug"}
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/tasks/2/issues", json={"title": "Bug"}
    )


async def test_update_task_issue(fake_client):
    fake_client.call_json.return_value = {"id": 3}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_task_issue",
            {"branch_id": 1, "task_id": 2, "issue_id": 3, "status": "closed"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/branches/1/tasks/2/issues/3", json={"status": "closed"}
    )


async def test_delete_task_issue(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "delete_task_issue", {"branch_id": 1, "task_id": 2, "issue_id": 3}
        )
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/branches/1/tasks/2/issues/3"
    )


async def test_add_issue_comment(fake_client):
    fake_client.call_json.return_value = {"id": 5}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "add_issue_comment",
            {"branch_id": 1, "task_id": 2, "issue_id": 3, "content": "<p>hi</p>"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/tasks/2/issues/3/comments", json={"content": "<p>hi</p>"}
    )


async def test_update_issue_comment(fake_client):
    fake_client.call_json.return_value = {"id": 5}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_issue_comment",
            {"branch_id": 1, "task_id": 2, "issue_id": 3, "comment_id": 5, "content": "<p>edit</p>"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/branches/1/tasks/2/issues/3/comments/5", json={"content": "<p>edit</p>"}
    )


async def test_delete_issue_comment(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "delete_issue_comment",
            {"branch_id": 1, "task_id": 2, "issue_id": 3, "comment_id": 5},
        )
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/branches/1/tasks/2/issues/3/comments/5"
    )


async def test_close_task_issue_no_comment(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "close_task_issue", {"branch_id": 1, "task_id": 2, "issue_id": 3}
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/tasks/2/issues/3/close", json={}
    )


async def test_close_task_issue_with_comment(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "close_task_issue",
            {"branch_id": 1, "task_id": 2, "issue_id": 3, "comment": "<p>done</p>"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/tasks/2/issues/3/close", json={"comment": "<p>done</p>"}
    )


async def test_reopen_task_issue(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "reopen_task_issue", {"branch_id": 1, "task_id": 2, "issue_id": 3}
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/tasks/2/issues/3/reopen", json={}
    )
