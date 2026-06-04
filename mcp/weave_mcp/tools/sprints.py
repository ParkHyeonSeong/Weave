from typing import Any

from .._app import mcp, get_client


@mcp.tool
async def list_sprints(branch_id: int) -> Any:
    """List all sprints in a branch."""
    return await get_client().call_json("GET", f"/api/branches/{branch_id}/sprints")


@mcp.tool
async def create_sprint(
    branch_id: int,
    sprint_name: str,
    goal: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> Any:
    """Create a new sprint in a branch.

    Only sprint_name is required. Dates are ISO format YYYY-MM-DD.
    """
    body = {"sprint_name": sprint_name}
    body.update({
        k: v for k, v in {
            "goal": goal,
            "start_date": start_date,
            "end_date": end_date,
        }.items() if v is not None
    })
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/sprints", json=body
    )


@mcp.tool
async def update_sprint(
    branch_id: int,
    sprint_id: int,
    sprint_name: str | None = None,
    goal: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    status: str | None = None,
) -> Any:
    """Update fields of an existing sprint. All parameters are optional.

    Dates are ISO format YYYY-MM-DD.
    """
    body = {k: v for k, v in {
        "sprint_name": sprint_name,
        "goal": goal,
        "start_date": start_date,
        "end_date": end_date,
        "status": status,
    }.items() if v is not None}
    return await get_client().call_json(
        "PATCH", f"/api/branches/{branch_id}/sprints/{sprint_id}", json=body
    )


@mcp.tool
async def delete_sprint(branch_id: int, sprint_id: int) -> Any:
    """Delete a sprint from a branch."""
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/sprints/{sprint_id}"
    )


@mcp.tool
async def start_sprint(branch_id: int, sprint_id: int) -> Any:
    """Start a sprint in a branch."""
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/sprints/{sprint_id}/start"
    )


@mcp.tool
async def complete_sprint(
    branch_id: int,
    sprint_id: int,
    move_to: str = "backlog",
) -> Any:
    """Complete a sprint in a branch.

    move_to can be "backlog" (default) or a sprint_id string to move
    incomplete tasks to another sprint.
    """
    return await get_client().call_json(
        "POST",
        f"/api/branches/{branch_id}/sprints/{sprint_id}/complete",
        json={"move_to": move_to},
    )
