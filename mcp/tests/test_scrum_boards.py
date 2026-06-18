from fastmcp import Client

from weave_mcp import _app


async def _call(tool, args):
    async with Client(_app.mcp) as client:
        return await client.call_tool(tool, args)


async def test_create_scrum_board_minimal(fake_client):
    fake_client.call_json.return_value = {"status": True, "board_id": 5}
    await _call("create_scrum_board", {"name": "Team A"})
    fake_client.call_json.assert_awaited_once_with("POST", "/api/scrum", json={"name": "Team A"})


async def test_create_scrum_board_with_options(fake_client):
    fake_client.call_json.return_value = {"status": True, "board_id": 5}
    await _call(
        "create_scrum_board",
        {"name": "Team A", "color": "#123456", "retro_cadence": "biweekly", "retro_anchor_weekday": 2},
    )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/scrum",
        json={"name": "Team A", "color": "#123456", "retro_cadence": "biweekly", "retro_anchor_weekday": 2},
    )


async def test_update_scrum_board(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("update_scrum_board", {"board_id": 5, "name": "New name", "color": "#000000"})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/scrum/5", json={"name": "New name", "color": "#000000"}
    )


async def test_delete_scrum_board_archives(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("delete_scrum_board", {"board_id": 5})
    fake_client.call_json.assert_awaited_once_with("DELETE", "/api/scrum/5")


async def test_restore_scrum_board(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("restore_scrum_board", {"board_id": 5})
    fake_client.call_json.assert_awaited_once_with("POST", "/api/scrum/5/restore")


async def test_leave_scrum_board(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("leave_scrum_board", {"board_id": 5})
    fake_client.call_json.assert_awaited_once_with("POST", "/api/scrum/5/leave")


async def test_list_archived_scrum_boards(fake_client):
    fake_client.call_json.return_value = {"status": True, "boards": []}
    await _call("list_archived_scrum_boards", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/archived")
