from fastmcp import Client

from weave_mcp import _app


async def test_search_tasks_default_scope(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("search_tasks", {"query": "login bug"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/chat/task-search", params={"q": "login bug", "mode": "my"}
    )


async def test_search_tasks_scope_all(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("search_tasks", {"query": "x", "scope": "all"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/chat/task-search", params={"q": "x", "mode": "all"}
    )


async def test_search_docs(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("search_docs", {"query": "spec"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/chat/doc-search", params={"q": "spec"}
    )


async def test_search_issues(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("search_issues", {"query": "crash"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/chat/issue-search", params={"q": "crash"}
    )
