from typing import Any

from .._app import mcp, get_client


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
async def list_track_items(track_id: int) -> Any:
    """List the work items collected in a track — tasks pulled in from its
    linked branches. For tasks scoped to a single branch use list_branch_tasks.
    """
    return await get_client().call_json("GET", f"/api/tracks/{track_id}/items")
