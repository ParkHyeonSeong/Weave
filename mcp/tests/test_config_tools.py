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


async def test_create_label(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("create_label", {"branch_id": 1, "label_name": "bug"})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/labels", json={"label_name": "bug"}
    )


async def test_list_custom_fields(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("list_custom_fields", {"branch_id": 1, "type_id": 4})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/1/task-types/4/custom-fields"
    )


async def test_create_workflow_status(fake_client):
    fake_client.call_json.return_value = {"status": True, "workflow_status_id": 5}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "create_workflow_status",
            {"branch_id": 1, "key": "in_review", "label": "In Review", "category": "in_progress"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/workflow-statuses",
        json={"key": "in_review", "label": "In Review", "category": "in_progress"},
    )


async def test_update_workflow_status(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_workflow_status",
            {"branch_id": 1, "status_id": 5, "label": "Reviewing"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/branches/1/workflow-statuses/5", json={"label": "Reviewing"}
    )


async def test_delete_workflow_status(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "delete_workflow_status", {"branch_id": 1, "status_id": 5}
        )
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/branches/1/workflow-statuses/5"
    )


async def test_reorder_workflow_statuses(fake_client):
    fake_client.call_json.return_value = {"status": True}
    items = [{"id": 5, "sort_order": 0}, {"id": 6, "sort_order": 1}]
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "reorder_workflow_statuses", {"branch_id": 1, "items": items}
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/workflow-statuses/reorder", json={"items": items}
    )


async def test_create_task_type(fake_client):
    fake_client.call_json.return_value = {"status": True, "type_id": 4}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "create_task_type",
            {"branch_id": 1, "type_key": "spike", "type_name": "Spike"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/task-types",
        json={"type_key": "spike", "type_name": "Spike"},
    )


async def test_update_task_type(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_task_type", {"branch_id": 1, "type_id": 4, "color": "#FF0000"}
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/branches/1/task-types/4", json={"color": "#FF0000"}
    )


async def test_delete_task_type(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("delete_task_type", {"branch_id": 1, "type_id": 4})
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/branches/1/task-types/4"
    )


async def test_update_label(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_label", {"branch_id": 1, "label_id": 7, "label_name": "urgent"}
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/branches/1/labels/7", json={"label_name": "urgent"}
    )


async def test_delete_label(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("delete_label", {"branch_id": 1, "label_id": 7})
    fake_client.call_json.assert_awaited_once_with("DELETE", "/api/branches/1/labels/7")


async def test_create_custom_field(fake_client):
    fake_client.call_json.return_value = {"status": True, "custom_field_id": 2}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "create_custom_field",
            {"branch_id": 1, "type_id": 4, "field_name": "Severity", "field_type": "select",
             "field_options": ["low", "high"]},
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/task-types/4/custom-fields",
        json={"field_name": "Severity", "field_type": "select", "field_options": ["low", "high"]},
    )


async def test_update_custom_field(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_custom_field",
            {"branch_id": 1, "type_id": 4, "field_id": 2, "field_name": "Sev"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/branches/1/task-types/4/custom-fields/2", json={"field_name": "Sev"}
    )


async def test_delete_custom_field(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "delete_custom_field", {"branch_id": 1, "type_id": 4, "field_id": 2}
        )
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/branches/1/task-types/4/custom-fields/2"
    )


async def test_reorder_custom_fields(fake_client):
    fake_client.call_json.return_value = {"status": True}
    items = [{"id": 2, "sort_order": 0}]
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "reorder_custom_fields", {"branch_id": 1, "type_id": 4, "items": items}
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/1/task-types/4/custom-fields/reorder", json={"items": items}
    )
