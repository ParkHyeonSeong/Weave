from typing import Any

from .._app import mcp, get_client, BranchRef


def _paging(limit: int | None, offset: int | None) -> dict:
    return {k: v for k, v in {"limit": limit, "offset": offset}.items() if v is not None}


@mcp.tool
async def list_task_activity(
    branch_id: BranchRef,
    task_id: int,
    limit: int | None = None,
    offset: int | None = None,
) -> Any:
    """List a task's activity history (who changed what, newest first).

    Paginated server-side: limit 1-100 (default 20), offset from 0.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/tasks/{task_id}/activity",
        params=_paging(limit, offset),
    )


@mcp.tool
async def list_branch_activity(
    branch_id: BranchRef,
    limit: int | None = None,
    offset: int | None = None,
) -> Any:
    """List a branch's activity feed (changes across its tasks, newest first).

    Paginated server-side: limit 1-100 (default 30), offset from 0.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/activity", params=_paging(limit, offset)
    )


@mcp.tool
async def list_canvas_activity(
    canvas_id: int,
    limit: int | None = None,
    offset: int | None = None,
) -> Any:
    """List a canvas's activity feed (page edits/changes, newest first).

    Paginated server-side: limit 1-100 (default 30), offset from 0.
    """
    return await get_client().call_json(
        "GET", f"/api/canvases/{canvas_id}/activity", params=_paging(limit, offset)
    )


@mcp.tool
async def list_canvas_page_activity(
    canvas_id: int,
    page_id: int,
    limit: int | None = None,
    offset: int | None = None,
) -> Any:
    """List a single canvas page's activity history (newest first).

    Paginated server-side: limit 1-100 (default 20), offset from 0.
    """
    return await get_client().call_json(
        "GET", f"/api/canvases/{canvas_id}/pages/{page_id}/activity",
        params=_paging(limit, offset),
    )
