from fastmcp import Client

from weave_mcp import _app


async def test_list_tracks(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_tracks", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/tracks")


async def test_get_track(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_track", {"track_id": 7})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/tracks/7")


async def test_get_track_home_stats(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_track_home_stats", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/tracks/home-stats")


async def test_list_track_branches(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_track_branches", {"track_id": 7})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/tracks/7/branches")


async def test_list_track_items(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_track_items", {"track_id": 7})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/tracks/7/items")
