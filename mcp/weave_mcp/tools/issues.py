from typing import Any

from .._app import mcp, get_client


@mcp.tool
async def list_task_issues(branch_id: int, task_id: int) -> Any:
    """List all issues linked to a task."""
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/tasks/{task_id}/issues"
    )


@mcp.tool
async def get_task_issue(branch_id: int, task_id: int, issue_id: int) -> Any:
    """Get full details of a single issue linked to a task."""
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/tasks/{task_id}/issues/{issue_id}"
    )


@mcp.tool
async def create_task_issue(
    branch_id: int,
    task_id: int,
    title: str,
    body: str | None = None,
) -> Any:
    """Create a new issue linked to a task. title is required; body is optional description text."""
    payload = {"title": title}
    payload.update({k: v for k, v in {"body": body}.items() if v is not None})
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/tasks/{task_id}/issues", json=payload
    )


@mcp.tool
async def update_task_issue(
    branch_id: int,
    task_id: int,
    issue_id: int,
    title: str | None = None,
    body: str | None = None,
    status: str | None = None,
) -> Any:
    """Update fields of an existing task issue. All parameters are optional."""
    payload = {k: v for k, v in {
        "title": title,
        "body": body,
        "status": status,
    }.items() if v is not None}
    return await get_client().call_json(
        "PATCH",
        f"/api/branches/{branch_id}/tasks/{task_id}/issues/{issue_id}",
        json=payload,
    )


@mcp.tool
async def delete_task_issue(branch_id: int, task_id: int, issue_id: int) -> Any:
    """Delete an issue linked to a task."""
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/tasks/{task_id}/issues/{issue_id}"
    )
