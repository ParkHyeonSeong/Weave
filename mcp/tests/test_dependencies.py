from fastmcp import Client

from weave_mcp import _app


async def test_list_task_dependencies(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("list_task_dependencies", {"branch_id": 1, "task_id": 2})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/1/dependencies/task/2"
    )


async def test_create_dependency(fake_client):
    fake_client.call_json.return_value = {"id": 99}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "create_dependency",
            {"branch_id": 1, "source_task_id": 2, "target_task_id": 3},
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST",
        "/api/branches/1/dependencies",
        json={"source_task_id": 2, "target_task_id": 3, "dep_type": "finish_to_start"},
    )


async def test_delete_dependency(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("delete_dependency", {"branch_id": 1, "dependency_id": 99})
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/branches/1/dependencies/99"
    )
