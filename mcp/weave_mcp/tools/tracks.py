from typing import Any

from .._app import mcp, get_client
from .._pagination import paginate


@mcp.tool
async def list_tracks() -> Any:
    """List all tracks (cross-branch workflows) the account can access.

    Each track includes progress_percent plus item_count, branch_count,
    member_count and a preview of its linked branches.
    """
    return await get_client().call_json("GET", "/api/tracks")


@mcp.tool
async def get_track(track_id: int) -> Any:
    """Get the full details of a single track.

    Use this when you already have a track_id and need the complete track
    object; list_tracks is the lighter overview of all tracks.
    """
    return await get_client().call_json("GET", f"/api/tracks/{track_id}")


@mcp.tool
async def get_track_home_stats() -> Any:
    """Get Track home KPI aggregates across accessible tracks.

    Returns active_track_count, connected_branch_count, in_progress_task_count
    and due_this_week_count.
    """
    return await get_client().call_json("GET", "/api/tracks/home-stats")


@mcp.tool
async def list_track_branches(track_id: int) -> Any:
    """List the branches participating in a track.

    Names and colors reflect any per-track display overrides.
    """
    return await get_client().call_json("GET", f"/api/tracks/{track_id}/branches")


@mcp.tool
async def list_track_items(
    track_id: int,
    limit: int | None = None,
    offset: int | None = None,
) -> Any:
    """List the work items collected in a track — tasks pulled in from its
    linked branches. For tasks scoped to a single branch use list_branch_tasks.

    Paginated client-side: returns the first `limit` items (default 50) from `offset`,
    plus a "pagination" summary (total/returned/has_more). Page with offset for the rest.
    """
    result = await get_client().call_json("GET", f"/api/tracks/{track_id}/items")
    return paginate(result, "items", limit=limit, offset=offset)


@mcp.tool
async def create_track(
    track_name: str,
    description: str | None = None,
    color: str | None = None,
    icon: str | None = None,
    visibility: str = "private",
    default_view: str = "flow",
    participating_branch_ids: list[int] | None = None,
) -> Any:
    """Create a new track (cross-branch workflow); you become its owner.

    track_name is required (max 300 chars). visibility is "private" (default) or
    "public". default_view is "flow" (default), "timeline", or "tree".
    participating_branch_ids attaches branches at creation.
    """
    body = {"track_name": track_name, "visibility": visibility, "default_view": default_view}
    body.update({k: v for k, v in {
        "description": description,
        "color": color,
        "icon": icon,
        "participating_branch_ids": participating_branch_ids,
    }.items() if v is not None})
    return await get_client().call_json("POST", "/api/tracks", json=body)


@mcp.tool
async def update_track(
    track_id: int,
    track_name: str | None = None,
    description: str | None = None,
    color: str | None = None,
    icon: str | None = None,
    visibility: str | None = None,
    default_view: str | None = None,
) -> Any:
    """Update track metadata; only provided fields change.

    color (if set) is #RRGGBB hex; visibility is "public"/"private"; default_view
    is "flow"/"timeline"/"tree".
    """
    body = {k: v for k, v in {
        "track_name": track_name,
        "description": description,
        "color": color,
        "icon": icon,
        "visibility": visibility,
        "default_view": default_view,
    }.items() if v is not None}
    return await get_client().call_json("PATCH", f"/api/tracks/{track_id}", json=body)


@mcp.tool
async def delete_track(track_id: int) -> Any:
    """Archive (soft-delete) a track. Reversible via restore_track. Owner-only."""
    return await get_client().call_json("DELETE", f"/api/tracks/{track_id}")


@mcp.tool
async def add_track_branch(track_id: int, branch_id: int) -> Any:
    """Attach a participating branch to a track."""
    return await get_client().call_json(
        "POST", f"/api/tracks/{track_id}/branches", json={"branch_id": branch_id}
    )


@mcp.tool
async def remove_track_branch(track_id: int, branch_id: int) -> Any:
    """Detach a participating branch from a track (may remove its sourced items)."""
    return await get_client().call_json(
        "DELETE", f"/api/tracks/{track_id}/branches/{branch_id}"
    )


@mcp.tool
async def search_track_sources(
    track_id: int,
    q: str | None = None,
    branch_id: int | None = None,
    sprint_id: int | None = None,
    epic_id: int | None = None,
    status: str | None = None,
    priority: str | None = None,
    exclude_done: bool | None = None,
    limit: int | None = None,
) -> Any:
    """Search candidate tasks (in the track's participating branches) to add as items.

    Returns source_task_id values for add_track_item / add_track_items_bulk. Filters
    are optional; results are capped (limit defaults to 50, max 200).
    """
    params = {k: v for k, v in {
        "q": q,
        "branch_id": branch_id,
        "sprint_id": sprint_id,
        "epic_id": epic_id,
        "status": status,
        "priority": priority,
        "exclude_done": exclude_done,
        "limit": limit,
    }.items() if v is not None}
    return await get_client().call_json(
        "GET", f"/api/tracks/{track_id}/sources", params=params
    )


@mcp.tool
async def add_track_item(
    track_id: int,
    source_task_id: int,
    position_x: float | None = None,
    position_y: float | None = None,
) -> Any:
    """Add a single task to a track as an item.

    Side-effect: auto-joins the task's branch as a participating branch; duplicate
    adds are ignored. position_x/position_y set the canvas placement.
    """
    body = {"source_task_id": source_task_id}
    body.update({k: v for k, v in {
        "position_x": position_x, "position_y": position_y,
    }.items() if v is not None})
    return await get_client().call_json(
        "POST", f"/api/tracks/{track_id}/items", json=body
    )


@mcp.tool
async def add_track_items_bulk(
    track_id: int,
    source_task_ids: list[int],
    scope_mode: str | None = None,
    scope_id: int | None = None,
) -> Any:
    """Add up to 200 tasks to a track at once.

    scope_mode is "sprint", "epic", or "filter"; scope_id is REQUIRED when
    scope_mode is "sprint" or "epic". Auto-joins participating branches and ignores
    duplicates.
    """
    body = {"source_task_ids": source_task_ids}
    body.update({k: v for k, v in {
        "scope_mode": scope_mode, "scope_id": scope_id,
    }.items() if v is not None})
    return await get_client().call_json(
        "POST", f"/api/tracks/{track_id}/items/bulk", json=body
    )


@mcp.tool
async def delete_track_item(track_id: int, item_id: int) -> Any:
    """Remove an item from a track (does not delete the underlying source task)."""
    return await get_client().call_json(
        "DELETE", f"/api/tracks/{track_id}/items/{item_id}"
    )


@mcp.tool
async def list_track_links(track_id: int) -> Any:
    """List the links (edges) between items in a track."""
    return await get_client().call_json("GET", f"/api/tracks/{track_id}/links")


@mcp.tool
async def add_track_link(
    track_id: int,
    source_item_id: int,
    target_item_id: int,
    link_type: str | None = None,
    materialize: bool | None = None,
) -> Any:
    """Create a link (edge) between two track items.

    link_type is "flow_to" (default) or "relates_to". If materialize is true and
    link_type is "flow_to", a real task dependency is also created between the
    underlying tasks (skipped, with a reason, if it would form a cycle).
    """
    body = {"source_item_id": source_item_id, "target_item_id": target_item_id}
    body.update({k: v for k, v in {
        "link_type": link_type, "materialize": materialize,
    }.items() if v is not None})
    return await get_client().call_json(
        "POST", f"/api/tracks/{track_id}/links", json=body
    )


@mcp.tool
async def delete_track_link(track_id: int, link_id: int) -> Any:
    """Delete a link (edge); also removes any dependency it materialized."""
    return await get_client().call_json(
        "DELETE", f"/api/tracks/{track_id}/links/{link_id}"
    )


@mcp.tool
async def list_track_members(track_id: int) -> Any:
    """List a track's members (user_id, name, role).

    Resolve a person's name to the user_id needed by the member-write tools.
    """
    return await get_client().call_json("GET", f"/api/tracks/{track_id}/members")


@mcp.tool
async def search_track_non_members(track_id: int, q: str = "") -> Any:
    """Search users who are NOT yet members of a track (candidates to invite).

    q matches name/email.
    """
    return await get_client().call_json(
        "GET", f"/api/tracks/{track_id}/members/search", params={"q": q}
    )


@mcp.tool
async def add_track_member(track_id: int, user_id: int, role: str = "editor") -> Any:
    """Add (invite) a user to a track. role is "viewer", "editor" (default), or "owner".

    Resolve user_id via search_track_non_members(track_id). Owner-only.
    """
    return await get_client().call_json(
        "POST", f"/api/tracks/{track_id}/members",
        json={"user_id": user_id, "role": role},
    )


@mcp.tool
async def update_track_member_role(track_id: int, user_id: int, role: str) -> Any:
    """Change a track member's role. role is "viewer", "editor", or "owner". Owner-only."""
    return await get_client().call_json(
        "PATCH", f"/api/tracks/{track_id}/members/{user_id}", json={"role": role}
    )


@mcp.tool
async def remove_track_member(track_id: int, user_id: int) -> Any:
    """Remove a member from a track. Owner-only."""
    return await get_client().call_json(
        "DELETE", f"/api/tracks/{track_id}/members/{user_id}"
    )


@mcp.tool
async def restore_track(track_id: int) -> Any:
    """Restore an archived track (see list_archived_tracks). Owner-only."""
    return await get_client().call_json("POST", f"/api/tracks/{track_id}/restore")


@mcp.tool
async def leave_track(track_id: int) -> Any:
    """Leave a track (remove yourself as a member); any member may leave.

    May be rejected with a business error if you are the track's last owner.
    """
    return await get_client().call_json("POST", f"/api/tracks/{track_id}/leave")


@mcp.tool
async def list_archived_tracks() -> Any:
    """List your archived tracks (candidates for restore_track)."""
    return await get_client().call_json("GET", "/api/tracks/archived")
