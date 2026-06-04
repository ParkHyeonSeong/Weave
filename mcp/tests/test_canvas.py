from fastmcp import Client

from weave_mcp import _app


async def test_list_canvases(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_canvases", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/canvases")


async def test_get_canvas_page_tree(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_canvas_page_tree", {"canvas_id": 1})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/canvases/1/pages")


async def test_get_canvas_page(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_canvas_page", {"canvas_id": 1, "page_id": 2})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/canvases/1/pages/2")


async def test_create_canvas_page(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("create_canvas_page", {"canvas_id": 1, "title": "Doc"})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/canvases/1/pages", json={"title": "Doc"}
    )


async def test_update_canvas_page(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_canvas_page",
            {"canvas_id": 1, "page_id": 2, "title": "New Title"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/canvases/1/pages/2", json={"title": "New Title"}
    )
