from fastmcp import Client

from weave_mcp import _app


async def _call(tool, args):
    async with Client(_app.mcp) as client:
        return await client.call_tool(tool, args)


async def test_list_my_tasks_does_not_forward_pagination_to_backend(fake_client):
    # /api/my-tasks has no limit/offset — paging is client-side only.
    fake_client.call_json.return_value = {"status": True, "tasks": [{"task_id": 1}]}
    await _call("list_my_tasks", {"limit": 5, "offset": 0})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/my-tasks", params={})


async def test_list_my_tasks_returns_bounded_page(fake_client):
    tasks = [{"task_id": i} for i in range(70)]
    fake_client.call_json.return_value = {"status": True, "tasks": tasks}
    result = await _call("list_my_tasks", {"limit": 10, "offset": 60})
    data = result.data
    assert [t["task_id"] for t in data["tasks"]] == list(range(60, 70))
    assert data["pagination"]["total"] == 70
    assert data["pagination"]["has_more"] is False


async def test_list_my_tasks_default_limit_bounds_full_set(fake_client):
    tasks = [{"task_id": i} for i in range(500)]
    fake_client.call_json.return_value = {"status": True, "tasks": tasks}
    result = await _call("list_my_tasks", {})
    data = result.data
    assert len(data["tasks"]) == 50
    assert data["pagination"]["has_more"] is True


async def test_search_tasks_pages_client_side(fake_client):
    tasks = [{"task_id": i} for i in range(80)]
    fake_client.call_json.return_value = {"status": True, "tasks": tasks}
    result = await _call("search_tasks", {"query": "x", "limit": 25})
    # query/mode still go to the backend; limit/offset are not forwarded
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/chat/task-search", params={"q": "x", "mode": "my"}
    )
    assert len(result.data["tasks"]) == 25
    assert result.data["pagination"]["total"] == 80


async def test_list_track_items_uses_items_key(fake_client):
    items = [{"item_id": i} for i in range(60)]
    fake_client.call_json.return_value = {"status": True, "items": items}
    result = await _call("list_track_items", {"track_id": 3, "limit": 10})
    assert len(result.data["items"]) == 10
    assert result.data["pagination"]["total"] == 60


async def test_pagination_passes_error_through(fake_client):
    fake_client.call_json.return_value = {"error": 401, "detail": "bad token"}
    result = await _call("list_branch_tasks", {"branch_id": 1})
    assert result.data["error"] == 401
    assert "pagination" not in result.data
