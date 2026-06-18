from fastmcp import Client

from weave_mcp import _app


async def _call(tool, args):
    async with Client(_app.mcp) as client:
        return await client.call_tool(tool, args)


# --- Activity feeds (backend-paginated: forward limit/offset only when given) ---
async def test_list_task_activity_default(fake_client):
    fake_client.call_json.return_value = {"status": True, "items": []}
    await _call("list_task_activity", {"branch_id": 7, "task_id": 81})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/7/tasks/81/activity", params={}
    )


async def test_list_task_activity_with_paging(fake_client):
    fake_client.call_json.return_value = {"status": True, "items": []}
    await _call("list_task_activity", {"branch_id": 7, "task_id": 81, "limit": 5, "offset": 10})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/7/tasks/81/activity", params={"limit": 5, "offset": 10}
    )


async def test_list_branch_activity(fake_client):
    fake_client.call_json.return_value = {"status": True, "items": []}
    await _call("list_branch_activity", {"branch_id": 7})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches/7/activity", params={})


async def test_list_canvas_activity(fake_client):
    fake_client.call_json.return_value = {"status": True, "items": []}
    await _call("list_canvas_activity", {"canvas_id": 4})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/canvases/4/activity", params={})


async def test_list_canvas_page_activity(fake_client):
    fake_client.call_json.return_value = {"status": True, "items": []}
    await _call("list_canvas_page_activity", {"canvas_id": 4, "page_id": 26})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/canvases/4/pages/26/activity", params={}
    )


# --- Recent views ---
async def test_list_recent_views_default(fake_client):
    fake_client.call_json.return_value = {"status": True, "items": []}
    await _call("list_recent_views", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/recent-views", params={})


async def test_list_recent_views_filtered(fake_client):
    fake_client.call_json.return_value = {"status": True, "items": []}
    await _call("list_recent_views", {"limit": 5, "item_type": "task"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/recent-views", params={"limit": 5, "type": "task"}
    )


# --- Batch ref status ---
async def test_batch_ref_status_sends_all_lists(fake_client):
    fake_client.call_json.return_value = {"status": True, "tasks": {}, "issues": {}, "pages": {}, "users": {}}
    await _call("batch_ref_status", {"task_ids": [1, 2], "page_ids": [9]})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/ref-status",
        json={"task_ids": [1, 2], "issue_ids": [], "page_ids": [9], "user_ids": []},
    )


# --- Calendar ---
async def test_list_calendar_tasks(fake_client):
    fake_client.call_json.return_value = {"status": True, "tasks": []}
    await _call("list_calendar_tasks", {"branch_id": 7, "range_start": "2026-06-01", "range_end": "2026-06-30"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/7/schedule-events/calendar-tasks",
        params={"range_start": "2026-06-01", "range_end": "2026-06-30"},
    )


async def test_list_calendar_epics(fake_client):
    fake_client.call_json.return_value = {"status": True, "epics": []}
    await _call("list_calendar_epics", {"branch_id": 7, "range_start": "2026-06-01", "range_end": "2026-06-30"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/7/schedule-events/calendar-epics",
        params={"range_start": "2026-06-01", "range_end": "2026-06-30"},
    )


# --- Epic dependencies ---
async def test_list_epic_dependencies(fake_client):
    fake_client.call_json.return_value = {"status": True, "dependencies": []}
    await _call("list_epic_dependencies", {"branch_id": 7, "epic_id": 10})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/7/dependencies/epic/10"
    )


# --- Reorders ---
async def test_reorder_epics(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("reorder_epics", {"branch_id": 7, "epic_ids": [3, 1, 2]})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/7/epics/reorder", json={"epic_ids": [3, 1, 2]}
    )


async def test_reorder_sprints(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("reorder_sprints", {"branch_id": 7, "sprint_ids": [5, 4]})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/7/sprints/reorder", json={"sprint_ids": [5, 4]}
    )
