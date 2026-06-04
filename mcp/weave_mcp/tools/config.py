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
