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
