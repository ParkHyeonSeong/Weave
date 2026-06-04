from typing import Any

from .._app import mcp, get_client


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
    body = {"title": title}
    body.update({
        k: v for k, v in {
            "description": description, "priority": priority,
            "status": status, "due_date": due_date,
        }.items() if v is not None
    })
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


@mcp.tool
async def list_branch_tasks(
    branch_id: int,
    sprint_id: int | None = None,
) -> Any:
    """List all tasks in a branch, optionally filtered by sprint."""
    params = {k: v for k, v in {"sprint_id": sprint_id}.items() if v is not None}
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/tasks", params=params
    )


@mcp.tool
async def update_task(
    branch_id: int,
    task_id: int,
    title: str | None = None,
    description: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    sprint_id: int | None = None,
    epic_id: int | None = None,
    start_date: str | None = None,
    due_date: str | None = None,
    label_ids: list[int] | None = None,
) -> Any:
    """Update fields of an existing task. All parameters are optional."""
    body = {k: v for k, v in {
        "title": title,
        "description": description,
        "status": status,
        "priority": priority,
        "sprint_id": sprint_id,
        "epic_id": epic_id,
        "start_date": start_date,
        "due_date": due_date,
        "label_ids": label_ids,
    }.items() if v is not None}
    return await get_client().call_json(
        "PATCH", f"/api/branches/{branch_id}/tasks/{task_id}", json=body
    )


@mcp.tool
async def delete_task(branch_id: int, task_id: int) -> Any:
    """Delete a task from a branch."""
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/tasks/{task_id}"
    )


@mcp.tool
async def list_task_comments(branch_id: int, task_id: int) -> Any:
    """List all comments on a task."""
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/tasks/{task_id}/comments"
    )


@mcp.tool
async def update_task_comment(
    branch_id: int,
    task_id: int,
    comment_id: int,
    content: str,
) -> Any:
    """Update the content of an existing task comment."""
    return await get_client().call_json(
        "PATCH",
        f"/api/branches/{branch_id}/tasks/{task_id}/comments/{comment_id}",
        json={"content": content},
    )


@mcp.tool
async def delete_task_comment(branch_id: int, task_id: int, comment_id: int) -> Any:
    """Delete a comment from a task."""
    return await get_client().call_json(
        "DELETE",
        f"/api/branches/{branch_id}/tasks/{task_id}/comments/{comment_id}",
    )
