from typing import Any

from .._app import mcp, get_client


@mcp.tool
async def list_notifications(limit: int | None = None, offset: int | None = None) -> Any:
    """List the current user's notifications, newest first.

    Results are paginated: limit is 1-100 (default 30), offset starts at 0. Page with
    offset to get older notifications.
    """
    params = {k: v for k, v in {"limit": limit, "offset": offset}.items() if v is not None}
    return await get_client().call_json("GET", "/api/notifications", params=params)


@mcp.tool
async def get_unread_notification_count() -> Any:
    """Get the count of the current user's unread notifications."""
    return await get_client().call_json("GET", "/api/notifications/unread-count")


@mcp.tool
async def mark_notification_read(notification_id: int) -> Any:
    """Mark a single notification as read."""
    return await get_client().call_json(
        "PATCH", f"/api/notifications/{notification_id}/read"
    )


@mcp.tool
async def mark_all_notifications_read() -> Any:
    """Mark all of the current user's unread notifications as read."""
    return await get_client().call_json("PATCH", "/api/notifications/read-all")


@mcp.tool
async def list_starred(item_type: str | None = None, limit: int | None = None) -> Any:
    """List the current user's starred items (capped; default 20, max 50).

    item_type filters by kind, e.g. "task" or "doc". limit adjusts the cap.
    """
    params = {k: v for k, v in {"type": item_type, "limit": limit}.items() if v is not None}
    return await get_client().call_json("GET", "/api/stars", params=params)


@mcp.tool
async def toggle_star(item_type: str, item_id: int) -> Any:
    """TOGGLE a star on a task or doc for the current user.

    item_type is "task" (item_id = task_id) or "doc" (item_id = canvas page_id).
    This TOGGLES: calling it again unstars. The response's "starred" field is the
    resulting state — call check_starred first if you need deterministic add/remove.
    """
    return await get_client().call_json(
        "POST", "/api/stars", json={"item_type": item_type, "item_id": item_id}
    )


@mcp.tool
async def check_starred(item_type: str, item_id: int) -> Any:
    """Check whether the current user has starred a task or doc.

    item_type is "task" or "doc". Returns {"status": True, "starred": bool}; a
    "message" with status False means an access/validation failure, not "not starred".
    """
    return await get_client().call_json(
        "GET", "/api/stars/check", params={"item_type": item_type, "item_id": item_id}
    )
