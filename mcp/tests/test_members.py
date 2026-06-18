from fastmcp import Client

from weave_mcp import _app


async def _call(tool, args):
    async with Client(_app.mcp) as client:
        return await client.call_tool(tool, args)


# --- Branch (reads already exist; these are the new writes) ---
async def test_add_branch_member_default_role(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("add_branch_member", {"branch_id": 7, "user_id": 5})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/7/members", json={"user_id": 5, "role": "member"}
    )


async def test_add_branch_member_explicit_role(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("add_branch_member", {"branch_id": 7, "user_id": 5, "role": "admin"})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/7/members", json={"user_id": 5, "role": "admin"}
    )


async def test_update_branch_member_role(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("update_branch_member_role", {"branch_id": 7, "user_id": 5, "role": "admin"})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/branches/7/members/5", json={"role": "admin"}
    )


async def test_remove_branch_member(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("remove_branch_member", {"branch_id": 7, "user_id": 5})
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/branches/7/members/5"
    )


# --- Canvas (reads + writes, all new) ---
async def test_list_canvas_members(fake_client):
    fake_client.call_json.return_value = {"status": True, "members": []}
    await _call("list_canvas_members", {"canvas_id": 4})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/canvases/4/members")


async def test_search_canvas_non_members(fake_client):
    fake_client.call_json.return_value = {"status": True, "users": []}
    await _call("search_canvas_non_members", {"canvas_id": 4, "q": "lee"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/canvases/4/members/search", params={"q": "lee"}
    )


async def test_search_canvas_non_members_default_q(fake_client):
    fake_client.call_json.return_value = {"status": True, "users": []}
    await _call("search_canvas_non_members", {"canvas_id": 4})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/canvases/4/members/search", params={"q": ""}
    )


async def test_add_canvas_member_default_role(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("add_canvas_member", {"canvas_id": 4, "user_id": 5})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/canvases/4/members", json={"user_id": 5, "role": "member"}
    )


async def test_update_canvas_member_role(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("update_canvas_member_role", {"canvas_id": 4, "user_id": 5, "role": "admin"})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/canvases/4/members/5", json={"role": "admin"}
    )


async def test_remove_canvas_member(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("remove_canvas_member", {"canvas_id": 4, "user_id": 5})
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/canvases/4/members/5"
    )


# --- Track (roles viewer/editor/owner; default editor) ---
async def test_list_track_members(fake_client):
    fake_client.call_json.return_value = {"status": True, "members": []}
    await _call("list_track_members", {"track_id": 1})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/tracks/1/members")


async def test_search_track_non_members(fake_client):
    fake_client.call_json.return_value = {"status": True, "users": []}
    await _call("search_track_non_members", {"track_id": 1, "q": "kim"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/tracks/1/members/search", params={"q": "kim"}
    )


async def test_add_track_member_default_role_is_editor(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("add_track_member", {"track_id": 1, "user_id": 5})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/tracks/1/members", json={"user_id": 5, "role": "editor"}
    )


async def test_update_track_member_role(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("update_track_member_role", {"track_id": 1, "user_id": 5, "role": "owner"})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/tracks/1/members/5", json={"role": "owner"}
    )


async def test_remove_track_member(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("remove_track_member", {"track_id": 1, "user_id": 5})
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/tracks/1/members/5"
    )


# --- Scrum (roles member/admin; default member) ---
async def test_list_scrum_members(fake_client):
    fake_client.call_json.return_value = {"status": True, "members": []}
    await _call("list_scrum_members", {"board_id": 1})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/1/members")


async def test_search_scrum_non_members(fake_client):
    fake_client.call_json.return_value = {"status": True, "users": []}
    await _call("search_scrum_non_members", {"board_id": 1, "q": "park"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/scrum/1/members/search", params={"q": "park"}
    )


async def test_add_scrum_member_default_role(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("add_scrum_member", {"board_id": 1, "user_id": 5})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/scrum/1/members", json={"user_id": 5, "role": "member"}
    )


async def test_update_scrum_member_role(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("update_scrum_member_role", {"board_id": 1, "user_id": 5, "role": "admin"})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/scrum/1/members/5", json={"role": "admin"}
    )


async def test_remove_scrum_member(fake_client):
    fake_client.call_json.return_value = {"status": True}
    await _call("remove_scrum_member", {"board_id": 1, "user_id": 5})
    fake_client.call_json.assert_awaited_once_with(
        "DELETE", "/api/scrum/1/members/5"
    )
