from datetime import date

from fastmcp import Client

from weave_mcp import _app
from weave_mcp.tools import scrum as scrum_tools


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


async def test_get_scrum_week_explicit(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_scrum_week", {"board_id": 4, "iso_year": 2026, "iso_week": 25})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/4/weeks/2026/25/cells")


async def test_get_scrum_week_defaults_to_today(fake_client, monkeypatch):
    monkeypatch.setattr(scrum_tools, "_today_kst", lambda: date(2026, 6, 15))  # ISO 2026-W25
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_scrum_week", {"board_id": 4})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/4/weeks/2026/25/cells")


async def test_write_scrum_daily_today_monday(fake_client, monkeypatch):
    monkeypatch.setattr(scrum_tools, "_today_kst", lambda: date(2026, 6, 15))  # 월요일 → day 0
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("write_scrum_daily", {"board_id": 4, "text": "로그인 수정"})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/scrum/4/weeks/2026/25/cells",
        json={"day": 0, "row": "plan", "text": "로그인 수정", "mode": "replace"})


async def test_write_scrum_daily_weekend_errors(fake_client, monkeypatch):
    monkeypatch.setattr(scrum_tools, "_today_kst", lambda: date(2026, 6, 13))  # 토요일
    async with Client(_app.mcp) as client:
        res = await client.call_tool("write_scrum_daily", {"board_id": 4, "text": "x"})
    fake_client.call_json.assert_not_awaited()
    err = res.data["error"]
    assert err["code"] == "WEEKEND_NO_CELL"
    assert err["category"] == "validation"
    assert err["retryable"] is False


async def test_write_scrum_daily_explicit_day(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("write_scrum_daily",
            {"board_id": 4, "text": "메모", "row": "gap", "day": 2,
             "mode": "append", "iso_year": 2026, "iso_week": 25})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/scrum/4/weeks/2026/25/cells",
        json={"day": 2, "row": "gap", "text": "메모", "mode": "append"})


async def test_get_current_retro(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_current_retro", {"board_id": 4})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/4/retros/current")


async def test_get_scrum_retro_cells(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_scrum_retro_cells", {"board_id": 4, "retro_id": 9})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/4/retros/9/cells")


async def test_write_scrum_retro(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("write_scrum_retro",
            {"board_id": 4, "retro_id": 9, "key": "keep", "text": "좋았던 점"})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/scrum/4/retros/9/cells",
        json={"key": "keep", "text": "좋았던 점", "mode": "replace"})


async def test_list_scrum_retros(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_scrum_retros", {"board_id": 4})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/4/retros")
