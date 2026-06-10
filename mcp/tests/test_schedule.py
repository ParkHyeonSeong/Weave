from fastmcp import Client

from weave_mcp import _app


async def test_list_schedule_events(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "list_schedule_events",
            {"branch_id": 3, "range_start": "2026-06-01", "range_end": "2026-06-30"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "GET",
        "/api/branches/3/schedule-events",
        params={"range_start": "2026-06-01", "range_end": "2026-06-30"},
    )


async def test_create_schedule_event_required_only(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "create_schedule_event",
            {"branch_id": 3, "title": "Kickoff", "start_date": "2026-06-10"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST",
        "/api/branches/3/schedule-events",
        json={"title": "Kickoff", "start_date": "2026-06-10"},
    )


async def test_create_schedule_event_with_optionals(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "create_schedule_event",
            {
                "branch_id": 3,
                "title": "Sprint",
                "start_date": "2026-06-10",
                "end_date": "2026-06-24",
                "participant_ids": [1, 2],
            },
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST",
        "/api/branches/3/schedule-events",
        json={
            "title": "Sprint",
            "start_date": "2026-06-10",
            "end_date": "2026-06-24",
            "participant_ids": [1, 2],
        },
    )


async def test_update_schedule_event(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_schedule_event",
            {"branch_id": 3, "event_id": 7, "title": "Renamed"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/branches/3/schedule-events/7", json={"title": "Renamed"}
    )


async def test_delete_schedule_event(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "delete_schedule_event", {"branch_id": 3, "event_id": 7}
        )
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/branches/3/schedule-events/7"
    )
