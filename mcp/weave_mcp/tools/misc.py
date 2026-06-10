from typing import Any

from .._app import mcp, get_client


@mcp.tool
async def get_current_user() -> Any:
    """Get the account this token acts as: {status, profile: {user_id, email, username, role}}.

    Call this to resolve "me"/"my" — e.g. before assigning a task to yourself,
    interpreting your own notifications/starred items, or checking whether you
    have the admin role. The token always acts as exactly this one user.
    """
    return await get_client().call_json("GET", "/api/auth/me")


@mcp.tool
async def list_branches() -> Any:
    """List all branches (projects) the account can access.

    Call this first — other tools need a branch_id, which comes from here.
    Each branch includes:
    - progress_percent: completion of the current active sprint(s) (terminal/total),
      or null when the branch has no active sprint.
    - active_sprint_count; active_sprint_name (the name when exactly one sprint is
      active, else null); sprint_task_total: tasks in the active sprint(s).
    - active_task_count: open (non-terminal) top-level tasks in the branch.
    - a preview of its members.
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
async def get_branch(branch_id: int) -> Any:
    """Get a single branch's detail, including your role in it."""
    return await get_client().call_json("GET", f"/api/branches/{branch_id}")


@mcp.tool
async def create_branch(
    branch_name: str,
    key: str,
    description: str | None = None,
    visibility: str = "private",
) -> Any:
    """Create a new branch (project).

    key is REQUIRED: 2-10 uppercase letters/numbers starting with a letter
    (e.g. "CORE", "WEB2") — it's the task-number prefix, uppercased server-side.
    visibility is "private" (default) or "public".
    """
    body = {"branch_name": branch_name, "key": key, "visibility": visibility}
    body.update({k: v for k, v in {"description": description}.items() if v is not None})
    return await get_client().call_json("POST", "/api/branches", json=body)


@mcp.tool
async def list_branch_members(branch_id: int) -> Any:
    """List a branch's members (user_id, name, role).

    Use this to resolve a person's name to the user_id needed for task assignees
    or event participants.
    """
    return await get_client().call_json("GET", f"/api/branches/{branch_id}/members")


@mcp.tool
async def search_branch_non_members(branch_id: int, q: str = "") -> Any:
    """Search users who are NOT yet members of a branch (candidates to invite).

    q matches name/email.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/members/search", params={"q": q}
    )


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
