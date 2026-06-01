from typing import Any

from fastmcp import FastMCP

from .client import WeaveClient

mcp = FastMCP("weave")

_client: WeaveClient | None = None


def get_client() -> WeaveClient:
    global _client
    if _client is None:
        _client = WeaveClient()
    return _client


@mcp.tool
async def list_branches() -> Any:
    """List all branches (projects) the account can access.

    Call this first — other tools need a branch_id, which comes from here.
    """
    return await get_client().call_json("GET", "/api/branches")


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


@mcp.tool
async def get_task(branch_id: int, task_id: int) -> Any:
    """Get full details of a single task within a branch."""
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/tasks/{task_id}"
    )


@mcp.tool
async def create_task(
    branch_id: int,
    title: str,
    description: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    due_date: str | None = None,
) -> Any:
    """Create a new task in a branch.

    Only title is required. priority must be one of low/medium/high/urgent.
    due_date is ISO format YYYY-MM-DD.
    """
    body = {
        k: v
        for k, v in {
            "title": title,
            "description": description,
            "priority": priority,
            "status": status,
            "due_date": due_date,
        }.items()
        if v is not None
    }
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/tasks", json=body
    )


@mcp.tool
async def add_task_comment(branch_id: int, task_id: int, content: str) -> Any:
    """Add a comment to a task. `content` is the comment text."""
    return await get_client().call_json(
        "POST",
        f"/api/branches/{branch_id}/tasks/{task_id}/comments",
        json={"content": content},
    )


def main() -> None:
    """Console-script / module entrypoint. Runs over stdio by default."""
    mcp.run()


if __name__ == "__main__":
    main()
