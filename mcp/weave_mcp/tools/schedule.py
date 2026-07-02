from typing import Any

from .._app import mcp, get_client, BranchRef


@mcp.tool
async def list_schedule_events(branch_id: BranchRef, range_start: str, range_end: str) -> Any:
    """List a branch's calendar events overlapping a date range.

    range_start and range_end are REQUIRED ISO dates (YYYY-MM-DD); the backend
    rejects the call without them.
    """
    return await get_client().call_json(
        "GET",
        f"/api/branches/{branch_id}/schedule-events",
        params={"range_start": range_start, "range_end": range_end},
    )


@mcp.tool
async def list_calendar_tasks(branch_id: BranchRef, range_start: str, range_end: str) -> Any:
    """List a branch's due-dated tasks falling in a date range, for calendar display.

    range_start/range_end are REQUIRED ISO dates (YYYY-MM-DD). Complements
    list_schedule_events by surfacing tasks (not just events) on the timeline.
    """
    return await get_client().call_json(
        "GET",
        f"/api/branches/{branch_id}/schedule-events/calendar-tasks",
        params={"range_start": range_start, "range_end": range_end},
    )


@mcp.tool
async def list_calendar_epics(branch_id: BranchRef, range_start: str, range_end: str) -> Any:
    """List a branch's epics spanning a date range, for calendar display.

    range_start/range_end are REQUIRED ISO dates (YYYY-MM-DD).
    """
    return await get_client().call_json(
        "GET",
        f"/api/branches/{branch_id}/schedule-events/calendar-epics",
        params={"range_start": range_start, "range_end": range_end},
    )


@mcp.tool
async def create_schedule_event(
    branch_id: BranchRef,
    title: str,
    start_date: str,
    end_date: str | None = None,
    description: str | None = None,
    color: str | None = None,
    participant_ids: list[int] | None = None,
) -> Any:
    """Create a calendar event in a branch.

    Dates are ISO (YYYY-MM-DD). end_date, when given, must be >= start_date.
    participant_ids are user ids (resolve names via list_branch_members once available).
    """
    body = {"title": title, "start_date": start_date}
    body.update(
        {
            k: v
            for k, v in {
                "end_date": end_date,
                "description": description,
                "color": color,
                "participant_ids": participant_ids,
            }.items()
            if v is not None
        }
    )
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/schedule-events", json=body
    )


@mcp.tool
async def update_schedule_event(
    branch_id: BranchRef,
    event_id: int,
    title: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    description: str | None = None,
    color: str | None = None,
    participant_ids: list[int] | None = None,
) -> Any:
    """Update a calendar event; only the fields you pass change. Dates are ISO (YYYY-MM-DD)."""
    body = {
        k: v
        for k, v in {
            "title": title,
            "start_date": start_date,
            "end_date": end_date,
            "description": description,
            "color": color,
            "participant_ids": participant_ids,
        }.items()
        if v is not None
    }
    return await get_client().call_json(
        "PATCH", f"/api/branches/{branch_id}/schedule-events/{event_id}", json=body
    )


@mcp.tool
async def delete_schedule_event(branch_id: BranchRef, event_id: int) -> Any:
    """Delete a calendar event."""
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/schedule-events/{event_id}"
    )


@mcp.tool
async def list_event_tasks(branch_id: BranchRef, event_id: int) -> Any:
    """List the tasks linked to a calendar event.

    Each entry includes the link's own id (link_id), which unlink_event_task needs.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/schedule-events/{event_id}/tasks"
    )


@mcp.tool
async def link_event_task(branch_id: BranchRef, event_id: int, task_id: int) -> Any:
    """Link a task to a calendar event."""
    return await get_client().call_json(
        "POST",
        f"/api/branches/{branch_id}/schedule-events/{event_id}/tasks",
        json={"task_id": task_id},
    )


@mcp.tool
async def search_event_tasks(branch_id: BranchRef, event_id: int, q: str) -> Any:
    """Search tasks that can be linked to a calendar event (typeahead). q must be non-empty."""
    return await get_client().call_json(
        "GET",
        f"/api/branches/{branch_id}/schedule-events/{event_id}/tasks/search",
        params={"q": q},
    )


@mcp.tool
async def unlink_event_task(branch_id: BranchRef, event_id: int, link_id: int) -> Any:
    """Remove an event↔task link. link_id is the link's id from list_event_tasks (not the task_id)."""
    return await get_client().call_json(
        "DELETE",
        f"/api/branches/{branch_id}/schedule-events/{event_id}/tasks/{link_id}",
    )
