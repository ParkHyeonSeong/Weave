from typing import Any

from .._app import mcp, get_client


@mcp.tool
async def list_branches() -> Any:
    """List all branches (projects) the account can access.

    Call this first — other tools need a branch_id, which comes from here.
    Each branch includes progress_percent, task_total, active_sprint_name and a
    preview of its members.
    """
    return await get_client().call_json("GET", "/api/branches")


@mcp.tool
async def get_branch_home_stats() -> Any:
    """Get Branch home KPI aggregates across accessible branches.

    Returns open_count, in_progress_count, due_this_week_count and
    active_sprint_count.
    """
    return await get_client().call_json("GET", "/api/branches/home-stats")


@mcp.tool
async def list_my_tasks(
    status: str | None = None,
    priority: str | None = None,
    branch_id: int | None = None,
) -> Any:
    """List tasks assigned to the account across branches.

    Optional filters: status, priority (low/medium/high/urgent), branch_id.
    """
    params = {
        k: v
        for k, v in {"status": status, "priority": priority, "branch_id": branch_id}.items()
        if v is not None
    }
    return await get_client().call_json("GET", "/api/my-tasks", params=params)
