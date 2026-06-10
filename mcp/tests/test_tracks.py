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


async def test_create_track(fake_client):
    fake_client.call_json.return_value = {"status": True, "track_id": 7}
    async with Client(_app.mcp) as client:
        await client.call_tool("create_track", {"track_name": "Q3 Launch"})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/tracks",
        json={"track_name": "Q3 Launch", "visibility": "private", "default_view": "flow"},
    )


async def test_update_track(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("update_track", {"track_id": 7, "track_name": "Renamed"})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/tracks/7", json={"track_name": "Renamed"}
    )


async def test_delete_track(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("delete_track", {"track_id": 7})
    fake_client.call_json.assert_awaited_once_with("DELETE", "/api/tracks/7")


async def test_add_track_branch(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("add_track_branch", {"track_id": 7, "branch_id": 3})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/tracks/7/branches", json={"branch_id": 3}
    )


async def test_remove_track_branch(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("remove_track_branch", {"track_id": 7, "branch_id": 3})
    fake_client.call_json.assert_awaited_once_with("DELETE", "/api/tracks/7/branches/3")


async def test_search_track_sources(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "search_track_sources", {"track_id": 7, "q": "api", "branch_id": 3}
        )
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/tracks/7/sources", params={"q": "api", "branch_id": 3}
    )


async def test_add_track_item(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "add_track_item", {"track_id": 7, "source_task_id": 42}
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/tracks/7/items", json={"source_task_id": 42}
    )


async def test_add_track_items_bulk(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "add_track_items_bulk",
            {"track_id": 7, "source_task_ids": [1, 2], "scope_mode": "sprint", "scope_id": 9},
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/tracks/7/items/bulk",
        json={"source_task_ids": [1, 2], "scope_mode": "sprint", "scope_id": 9},
    )


async def test_delete_track_item(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("delete_track_item", {"track_id": 7, "item_id": 5})
    fake_client.call_json.assert_awaited_once_with("DELETE", "/api/tracks/7/items/5")


async def test_list_track_links(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("list_track_links", {"track_id": 7})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/tracks/7/links")


async def test_add_track_link(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "add_track_link",
            {"track_id": 7, "source_item_id": 1, "target_item_id": 2, "materialize": True},
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/tracks/7/links",
        json={"source_item_id": 1, "target_item_id": 2, "materialize": True},
    )


async def test_delete_track_link(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("delete_track_link", {"track_id": 7, "link_id": 4})
    fake_client.call_json.assert_awaited_once_with("DELETE", "/api/tracks/7/links/4")
