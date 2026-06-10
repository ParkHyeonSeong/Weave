from typing import Any

from .._app import mcp, get_client


@mcp.tool
async def list_labels(branch_id: int) -> Any:
    """List all labels defined for a branch.

    Returns the valid label values to use when creating or updating tasks.
    """
    return await get_client().call_json("GET", f"/api/branches/{branch_id}/labels")


@mcp.tool
async def list_workflow_statuses(branch_id: int) -> Any:
    """List all workflow statuses defined for a branch.

    Returns the valid status values to use when creating or updating tasks.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/workflow-statuses"
    )


@mcp.tool
async def list_task_types(branch_id: int) -> Any:
    """List all task types defined for a branch.

    Returns the valid task type values to use when creating or updating tasks.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/task-types"
    )


@mcp.tool
async def create_label(branch_id: int, label_name: str, color: str | None = None) -> Any:
    """Create a new label in a branch. color is a hex string (defaults to #5E6AD2)."""
    body = {"label_name": label_name}
    body.update({k: v for k, v in {"color": color}.items() if v is not None})
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/labels", json=body
    )


@mcp.tool
async def list_custom_fields(branch_id: int, type_id: int) -> Any:
    """List the custom fields defined for a task type.

    Use this to discover the keys/types accepted by create_task/update_task's
    custom_fields. type_id comes from list_task_types.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/task-types/{type_id}/custom-fields"
    )
