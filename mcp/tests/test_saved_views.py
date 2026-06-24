from fastmcp import Client

from weave_mcp import _app


async def test_query_tasks_saved_view(fake_client):
    fake_client.call_json.return_value = {"status": True, "items": []}
    async with Client(_app.mcp) as client:
        await client.call_tool("query_tasks", {"branch_id": 3, "saved_view_id": 9})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/3/tasks/query",
        json={"filter": None, "group_by": None, "sort": [], "limit": 50, "offset": 0, "saved_view_id": 9})


async def test_query_tasks_cross_saved_view(fake_client):
    # branch_id 없으면 크로스 경로(/api/tasks/query) + scope 포함
    fake_client.call_json.return_value = {"status": True, "items": []}
    async with Client(_app.mcp) as client:
        await client.call_tool("query_tasks", {"saved_view_id": 5, "scope": "all"})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/tasks/query",
        json={"filter": None, "group_by": None, "sort": [], "limit": 50, "offset": 0,
              "saved_view_id": 5, "scope": "all"})


async def test_query_tasks_no_saved_view_omits_key(fake_client):
    # saved_view_id 미지정 시 body에 키가 없어야(기존 계약 유지)
    fake_client.call_json.return_value = {"status": True, "items": []}
    async with Client(_app.mcp) as client:
        await client.call_tool("query_tasks", {"branch_id": 3})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/3/tasks/query",
        json={"filter": None, "group_by": None, "sort": [], "limit": 50, "offset": 0})


async def test_list_saved_views(fake_client):
    fake_client.call_json.return_value = {"status": True, "views": []}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_saved_views", {"scope_branch_id": 3})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/saved-views", params={"scope_branch_id": 3})


async def test_list_saved_views_personal(fake_client):
    fake_client.call_json.return_value = {"status": True, "views": []}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_saved_views", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/saved-views", params={})


async def test_query_tasks_assignee_groups_null(fake_client):
    # group_by 계약: assignee/label → 서버 groups=null, MCP는 그대로 통과(태스크는 정상)
    fake_client.call_json.return_value = {"status": True, "items": [{"task_id": 1}], "groups": None}
    async with Client(_app.mcp) as client:
        res = await client.call_tool("query_tasks", {"branch_id": 3, "group_by": "assignee"})
    assert res.data["groups"] is None and res.data["items"]
