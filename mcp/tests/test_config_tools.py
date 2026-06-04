from fastmcp import Client

from weave_mcp import _app


async def test_list_labels(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_labels", {"branch_id": 1})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches/1/labels")


async def test_list_workflow_statuses(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_workflow_statuses", {"branch_id": 1})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/1/workflow-statuses"
    )


async def test_list_task_types(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_task_types", {"branch_id": 1})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/1/task-types"
    )
