from typing import Any

from .._app import mcp, get_client


@mcp.tool
async def list_canvases() -> Any:
    """List all canvases available to the current user.

    Each canvas includes page_count, last_edited_at and a preview of its
    contributors.
    """
    return await get_client().call_json("GET", "/api/canvases")


@mcp.tool
async def get_canvas_home_stats() -> Any:
    """Get Canvas home KPI aggregates across accessible canvases.

    Returns total_docs, edited_this_week and starred_count.
    """
    return await get_client().call_json("GET", "/api/canvases/home-stats")


@mcp.tool
async def get_canvas_page_tree(canvas_id: int) -> Any:
    """Get the full page tree (hierarchy) for a canvas."""
    return await get_client().call_json(
        "GET", f"/api/canvases/{canvas_id}/pages"
    )


@mcp.tool
async def get_canvas_page(canvas_id: int, page_id: int) -> Any:
    """Get a single canvas page including its content."""
    return await get_client().call_json(
        "GET", f"/api/canvases/{canvas_id}/pages/{page_id}"
    )


@mcp.tool
async def create_canvas_page(
    canvas_id: int,
    title: str,
    content: str | None = None,
    parent_page_id: int | None = None,
) -> Any:
    """Create a new page in a canvas.

    Only title is required. content sets the initial page body.
    parent_page_id nests the new page under an existing page.
    """
    body = {"title": title}
    body.update({
        k: v for k, v in {
            "content": content,
            "parent_page_id": parent_page_id,
        }.items() if v is not None
    })
    return await get_client().call_json(
        "POST", f"/api/canvases/{canvas_id}/pages", json=body
    )


@mcp.tool
async def update_canvas_page(
    canvas_id: int,
    page_id: int,
    title: str | None = None,
    content: str | None = None,
) -> Any:
    """Update a canvas page's title or content.

    WARNING: providing `content` replaces the entire page body — partial
    updates are not supported; you must pass the full desired content.
    """
    body = {k: v for k, v in {
        "title": title,
        "content": content,
    }.items() if v is not None}
    return await get_client().call_json(
        "PATCH", f"/api/canvases/{canvas_id}/pages/{page_id}", json=body
    )
