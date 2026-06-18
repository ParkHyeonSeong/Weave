from fastmcp import Client

from weave_mcp import _app


async def _call(tool, args):
    async with Client(_app.mcp) as client:
        return await client.call_tool(tool, args)


# --- Branch container lifecycle ---
async def test_update_branch_single_field(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("update_branch", {"branch_id": 7, "branch_name": "Renamed"})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/branches/7", json={"branch_name": "Renamed"}
    )


async def test_update_branch_multi_field(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call(
        "update_branch",
        {"branch_id": 7, "branch_name": "X", "visibility": "public", "color": "#123456"},
    )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/branches/7",
        json={"branch_name": "X", "visibility": "public", "color": "#123456"},
    )


async def test_delete_branch_archives(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("delete_branch", {"branch_id": 7})
    fake_client.call_json.assert_awaited_once_with("DELETE", "/api/branches/7")


async def test_restore_branch(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("restore_branch", {"branch_id": 7})
    fake_client.call_json.assert_awaited_once_with("POST", "/api/branches/7/restore")


async def test_leave_branch(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("leave_branch", {"branch_id": 7})
    fake_client.call_json.assert_awaited_once_with("POST", "/api/branches/7/leave")


async def test_join_branch(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("join_branch", {"branch_id": 7})
    fake_client.call_json.assert_awaited_once_with("POST", "/api/branches/7/join")


async def test_list_archived_branches(fake_client):
    fake_client.call_json.return_value = {"status": True, "branches": []}
    await _call("list_archived_branches", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches/archived")


async def test_list_public_branches(fake_client):
    fake_client.call_json.return_value = {"status": True, "branches": []}
    await _call("list_public_branches", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches/public")


# --- Canvas container lifecycle ---
async def test_restore_canvas(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("restore_canvas", {"canvas_id": 4})
    fake_client.call_json.assert_awaited_once_with("POST", "/api/canvases/4/restore")


async def test_leave_canvas(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("leave_canvas", {"canvas_id": 4})
    fake_client.call_json.assert_awaited_once_with("POST", "/api/canvases/4/leave")


async def test_join_canvas(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("join_canvas", {"canvas_id": 4})
    fake_client.call_json.assert_awaited_once_with("POST", "/api/canvases/4/join")


async def test_list_archived_canvases(fake_client):
    fake_client.call_json.return_value = {"status": True, "canvases": []}
    await _call("list_archived_canvases", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/canvases/archived")


async def test_list_public_canvases(fake_client):
    fake_client.call_json.return_value = {"status": True, "canvases": []}
    await _call("list_public_canvases", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/canvases/public")


# --- Track container lifecycle ---
async def test_restore_track(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("restore_track", {"track_id": 1})
    fake_client.call_json.assert_awaited_once_with("POST", "/api/tracks/1/restore")


async def test_leave_track(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("leave_track", {"track_id": 1})
    fake_client.call_json.assert_awaited_once_with("POST", "/api/tracks/1/leave")


async def test_list_archived_tracks(fake_client):
    fake_client.call_json.return_value = {"status": True, "tracks": []}
    await _call("list_archived_tracks", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/tracks/archived")
