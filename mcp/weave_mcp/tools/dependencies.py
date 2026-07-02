from typing import Any

from .._app import mcp, get_client, BranchRef


@mcp.tool
async def list_task_dependencies(branch_id: BranchRef, task_id: int) -> Any:
    """List all dependencies for a task."""
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/dependencies/task/{task_id}"
    )


@mcp.tool
async def list_epic_dependencies(branch_id: BranchRef, epic_id: int) -> Any:
    """List the dependencies among an epic's tasks (epic-level dependency graph).

    Complements list_task_dependencies (which is per single task).
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/dependencies/epic/{epic_id}"
    )


@mcp.tool
async def create_dependency(
    branch_id: BranchRef,
    source_task_id: int,
    target_task_id: int,
    dep_type: str = "finish_to_start",
) -> Any:
    """Create a dependency between two tasks. dep_type is 'finish_to_start' or 'relates_to'."""
    return await get_client().call_json(
        "POST",
        f"/api/branches/{branch_id}/dependencies",
        json={
            "source_task_id": source_task_id,
            "target_task_id": target_task_id,
            "dep_type": dep_type,
        },
    )


@mcp.tool
async def delete_dependency(branch_id: BranchRef, dependency_id: int) -> Any:
    """Delete a dependency by its ID."""
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/dependencies/{dependency_id}"
    )
