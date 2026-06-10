from fastmcp import Client

from weave_mcp import _app


async def test_list_scrum_boards(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("list_scrum_boards", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum")


async def test_get_scrum_board(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_scrum_board", {"board_id": 4})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/4")


async def test_get_scrum_home_cards(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_scrum_home_cards", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/home-cards")
