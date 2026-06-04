from typing import Any

from .._app import mcp, get_client


@mcp.tool
async def list_notifications() -> Any:
    """List all notifications for the current user."""
    return await get_client().call_json("GET", "/api/notifications")


@mcp.tool
async def mark_notification_read(notification_id: int) -> Any:
    """Mark a single notification as read."""
    return await get_client().call_json(
        "PATCH", f"/api/notifications/{notification_id}/read"
    )


@mcp.tool
async def list_starred(item_type: str | None = None) -> Any:
    """List all starred items for the current user.

    item_type filters by kind, e.g. "task" or "doc".
    """
    params = {k: v for k, v in {"type": item_type}.items() if v is not None}
    return await get_client().call_json("GET", "/api/stars", params=params)
