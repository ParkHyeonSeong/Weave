from typing import Any

from .._app import mcp, get_client
from .._pagination import paginate


@mcp.tool
async def list_epics(branch_id: int) -> Any:
    """List all epics in a branch."""
    return await get_client().call_json("GET", f"/api/branches/{branch_id}/epics")


@mcp.tool
async def get_epic(branch_id: int, epic_id: int) -> Any:
    """Get full details of a single epic within a branch."""
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/epics/{epic_id}"
    )


@mcp.tool
async def create_epic(
    branch_id: int,
    epic_name: str,
    description: str | None = None,
    status: str | None = None,
    color: str | None = None,
    start_date: str | None = None,
    due_date: str | None = None,
) -> Any:
    """Create a new epic in a branch.

    Only epic_name is required. color is a hex string like #5E6AD2.
    Dates are ISO format YYYY-MM-DD.
    """
    body = {"epic_name": epic_name}
    body.update({
        k: v for k, v in {
            "description": description,
            "status": status,
            "color": color,
            "start_date": start_date,
            "due_date": due_date,
        }.items() if v is not None
    })
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/epics", json=body
    )


@mcp.tool
async def update_epic(
    branch_id: int,
    epic_id: int,
    epic_name: str | None = None,
    description: str | None = None,
    status: str | None = None,
    color: str | None = None,
    start_date: str | None = None,
    due_date: str | None = None,
) -> Any:
    """Update fields of an existing epic. All parameters are optional.

    color is a hex string like #5E6AD2. Dates are ISO format YYYY-MM-DD.
    """
    body = {k: v for k, v in {
        "epic_name": epic_name,
        "description": description,
        "status": status,
        "color": color,
        "start_date": start_date,
        "due_date": due_date,
    }.items() if v is not None}
    return await get_client().call_json(
        "PATCH", f"/api/branches/{branch_id}/epics/{epic_id}", json=body
    )


@mcp.tool
async def delete_epic(branch_id: int, epic_id: int) -> Any:
    """Delete an epic from a branch."""
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/epics/{epic_id}"
    )


@mcp.tool
async def reorder_epics(branch_id: int, epic_ids: list[int]) -> Any:
    """Reorder a branch's epics. epic_ids is the full list in the desired order."""
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/epics/reorder", json={"epic_ids": epic_ids}
    )


@mcp.tool
async def list_epic_tasks(
    branch_id: int,
    epic_id: int,
    limit: int | None = None,
    offset: int | None = None,
) -> Any:
    """List the tasks belonging to an epic.

    list_branch_tasks can only filter by sprint, so this is the way to enumerate an
    epic's tasks.

    Paginated client-side: returns the first `limit` tasks (default 50) from `offset`,
    plus a "pagination" summary (total/returned/has_more). Page with offset for the rest.
    """
    result = await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/epics/{epic_id}/tasks"
    )
    return paginate(result, "tasks", limit=limit, offset=offset)
