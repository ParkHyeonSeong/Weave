from typing import Any

from .._app import mcp, get_client


@mcp.tool
async def list_labels(branch_id: int) -> Any:
    """List all labels defined for a branch.

    Returns the valid label values to use when creating or updating tasks.
    """
    return await get_client().call_json("GET", f"/api/branches/{branch_id}/labels")


@mcp.tool
async def list_workflow_statuses(branch_id: int) -> Any:
    """List all workflow statuses defined for a branch.

    Returns the valid status values to use when creating or updating tasks.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/workflow-statuses"
    )


@mcp.tool
async def list_task_types(branch_id: int) -> Any:
    """List all task types defined for a branch.

    Returns the valid task type values to use when creating or updating tasks.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/task-types"
    )


@mcp.tool
async def create_label(branch_id: int, label_name: str, color: str | None = None) -> Any:
    """Create a new label in a branch. color is a hex string (defaults to #5E6AD2)."""
    body = {"label_name": label_name}
    body.update({k: v for k, v in {"color": color}.items() if v is not None})
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/labels", json=body
    )


@mcp.tool
async def list_custom_fields(branch_id: int, type_id: int) -> Any:
    """List the custom fields defined for a task type.

    Use this to discover the keys/types accepted by create_task/update_task's
    custom_fields. type_id comes from list_task_types.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/task-types/{type_id}/custom-fields"
    )


@mcp.tool
async def create_workflow_status(
    branch_id: int,
    key: str,
    label: str,
    category: str,
    color: str | None = None,
) -> Any:
    """Create a workflow status in a branch (admin only).

    key is lowercase letters/numbers/underscore starting with a letter. category must be
    "todo", "in_progress", "done", or "cancelled". color is hex (default #9CA3AF).
    """
    body = {"key": key, "label": label, "category": category}
    body.update({k: v for k, v in {"color": color}.items() if v is not None})
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/workflow-statuses", json=body
    )


@mcp.tool
async def update_workflow_status(
    branch_id: int,
    status_id: int,
    label: str | None = None,
    color: str | None = None,
    category: str | None = None,
    is_default: bool | None = None,
) -> Any:
    """Update a workflow status (admin only); only provided fields change.

    category, if set, must be todo/in_progress/done/cancelled. is_default=true makes this
    the branch's default status. The key cannot be changed.
    """
    body = {k: v for k, v in {
        "label": label,
        "color": color,
        "category": category,
        "is_default": is_default,
    }.items() if v is not None}
    return await get_client().call_json(
        "PATCH", f"/api/branches/{branch_id}/workflow-statuses/{status_id}", json=body
    )


@mcp.tool
async def delete_workflow_status(branch_id: int, status_id: int) -> Any:
    """Delete a workflow status (admin only).

    Fails if it is the last remaining status or any task currently uses it.
    """
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/workflow-statuses/{status_id}"
    )


@mcp.tool
async def reorder_workflow_statuses(branch_id: int, items: list[dict]) -> Any:
    """Reorder a branch's workflow statuses (admin only).

    items is a list of {"id": status_id, "sort_order": int}.
    """
    return await get_client().call_json(
        "POST",
        f"/api/branches/{branch_id}/workflow-statuses/reorder",
        json={"items": items},
    )


@mcp.tool
async def create_task_type(
    branch_id: int,
    type_key: str,
    type_name: str,
    icon: str | None = None,
    color: str | None = None,
) -> Any:
    """Create a task type in a branch (admin only).

    type_key is lowercase letters/numbers/underscore starting with a letter. icon
    defaults to "CheckSquare"; color is hex (default #5E6AD2).
    """
    body = {"type_key": type_key, "type_name": type_name}
    body.update({k: v for k, v in {"icon": icon, "color": color}.items() if v is not None})
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/task-types", json=body
    )


@mcp.tool
async def update_task_type(
    branch_id: int,
    type_id: int,
    type_name: str | None = None,
    icon: str | None = None,
    color: str | None = None,
) -> Any:
    """Update a task type (admin only); only provided fields change. The type_key cannot be changed."""
    body = {k: v for k, v in {
        "type_name": type_name,
        "icon": icon,
        "color": color,
    }.items() if v is not None}
    return await get_client().call_json(
        "PATCH", f"/api/branches/{branch_id}/task-types/{type_id}", json=body
    )


@mcp.tool
async def delete_task_type(branch_id: int, type_id: int) -> Any:
    """Delete a task type (admin only).

    Fails if it is the last remaining type or any task currently uses it.
    """
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/task-types/{type_id}"
    )


@mcp.tool
async def update_label(
    branch_id: int,
    label_id: int,
    label_name: str | None = None,
    color: str | None = None,
) -> Any:
    """Update a label's name and/or color (any branch member)."""
    body = {k: v for k, v in {"label_name": label_name, "color": color}.items() if v is not None}
    return await get_client().call_json(
        "PATCH", f"/api/branches/{branch_id}/labels/{label_id}", json=body
    )


@mcp.tool
async def delete_label(branch_id: int, label_id: int) -> Any:
    """Delete a label (any branch member)."""
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/labels/{label_id}"
    )


@mcp.tool
async def create_custom_field(
    branch_id: int,
    type_id: int,
    field_name: str,
    field_type: str,
    field_options: list[str] | None = None,
    is_required: bool | None = None,
) -> Any:
    """Create a custom field on a task type (admin only).

    field_type must be one of "text", "number", "select", "date", "checkbox", "url".
    field_options are the choices for a "select" field.
    """
    body = {"field_name": field_name, "field_type": field_type}
    body.update({k: v for k, v in {
        "field_options": field_options, "is_required": is_required,
    }.items() if v is not None})
    return await get_client().call_json(
        "POST",
        f"/api/branches/{branch_id}/task-types/{type_id}/custom-fields",
        json=body,
    )


@mcp.tool
async def update_custom_field(
    branch_id: int,
    type_id: int,
    field_id: int,
    field_name: str | None = None,
    field_type: str | None = None,
    field_options: list[str] | None = None,
    is_required: bool | None = None,
) -> Any:
    """Update a custom field (admin only); only provided fields change.

    field_type, if set, must be one of text/number/select/date/checkbox/url.
    """
    body = {k: v for k, v in {
        "field_name": field_name,
        "field_type": field_type,
        "field_options": field_options,
        "is_required": is_required,
    }.items() if v is not None}
    return await get_client().call_json(
        "PATCH",
        f"/api/branches/{branch_id}/task-types/{type_id}/custom-fields/{field_id}",
        json=body,
    )


@mcp.tool
async def delete_custom_field(branch_id: int, type_id: int, field_id: int) -> Any:
    """Delete a custom field from a task type (admin only)."""
    return await get_client().call_json(
        "DELETE",
        f"/api/branches/{branch_id}/task-types/{type_id}/custom-fields/{field_id}",
    )


@mcp.tool
async def reorder_custom_fields(branch_id: int, type_id: int, items: list[dict]) -> Any:
    """Reorder a task type's custom fields (admin only).

    items is a list of {"id": field_id, "sort_order": int}.
    """
    return await get_client().call_json(
        "POST",
        f"/api/branches/{branch_id}/task-types/{type_id}/custom-fields/reorder",
        json={"items": items},
    )
