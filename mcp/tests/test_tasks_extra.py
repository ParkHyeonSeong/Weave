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


async def test_create_task_with_assignees(fake_client):
    fake_client.call_json.return_value = {"id": 11}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "create_task",
            {
                "branch_id": 3,
                "title": "Build",
                "assignee_main": 7,
                "assignee_sub": [8, 9],
                "parent_task_id": 4,
            },
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST",
        "/api/branches/3/tasks",
        json={"title": "Build", "parent_task_id": 4, "assignees": {"main": 7, "sub": [8, 9]}},
    )


async def test_update_task_with_assignee_main(fake_client):
    fake_client.call_json.return_value = {"id": 5}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_task", {"branch_id": 3, "task_id": 5, "assignee_main": 7}
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/branches/3/tasks/5", json={"assignees": {"main": 7}}
    )


async def test_reorder_tasks_into_sprint(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "reorder_tasks",
            {"branch_id": 3, "task_ids": [5, 6], "sprint_id": 7, "after_task_id": 4},
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST",
        "/api/branches/3/tasks/reorder",
        json={"task_ids": [5, 6], "sprint_id": 7, "after_task_id": 4},
    )


async def test_reorder_tasks_to_backlog(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("reorder_tasks", {"branch_id": 3, "task_ids": [5]})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/3/tasks/reorder", json={"task_ids": [5]}
    )


async def test_delete_task(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("delete_task", {"branch_id": 3, "task_id": 5})
    fake_client.call_json.assert_awaited_once_with("DELETE", "/api/branches/3/tasks/5")


async def test_list_archived_tasks(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("list_archived_tasks", {"branch_id": 3})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches/3/tasks/archive")


async def test_list_task_pages(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("list_task_pages", {"branch_id": 3, "task_id": 5})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches/3/tasks/5/pages")


async def test_link_task_page(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "link_task_page", {"branch_id": 3, "task_id": 5, "page_id": 8}
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/3/tasks/5/pages", json={"page_id": 8}
    )


async def test_search_task_pages(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "search_task_pages", {"branch_id": 3, "task_id": 5, "q": "spec"}
        )
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/3/tasks/5/pages/search", params={"q": "spec"}
    )


async def test_unlink_task_page(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "unlink_task_page", {"branch_id": 3, "task_id": 5, "link_id": 9}
        )
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/branches/3/tasks/5/pages/9"
    )


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
