from datetime import datetime, timedelta, timezone
from typing import Any

from .._app import mcp, get_client

_KST = timezone(timedelta(hours=9))


def _today_kst():
    """KST 기준 오늘 (테스트에서 monkeypatch 가능하도록 모듈 함수로 노출)."""
    return datetime.now(_KST).date()


@mcp.tool
async def list_scrum_boards() -> Any:
    """List the Scrum boards (weekly daily-scrum + retrospective) you belong to.

    Call first to get a board_id for the other Scrum tools.
    """
    return await get_client().call_json("GET", "/api/scrum")


@mcp.tool
async def get_scrum_board(board_id: int) -> Any:
    """Get a Scrum board's metadata: config, members, and your role.

    Note: the daily-scrum cells and retro KPT cards are real-time collaborative
    (Yjs over WebSocket) and are NOT returned here — only board metadata is
    reachable over REST.
    """
    return await get_client().call_json("GET", f"/api/scrum/{board_id}")


@mcp.tool
async def get_scrum_home_cards() -> Any:
    """Get cross-board Scrum home cards (e.g. today's unwritten daily-scrum, due retros)."""
    return await get_client().call_json("GET", "/api/scrum/home-cards")


@mcp.tool
async def get_scrum_week(board_id: int, iso_year: int | None = None,
                         iso_week: int | None = None) -> Any:
    """Read a weekly daily-scrum grid's cells (per member × weekday × plan/gap) as plain text.

    iso_year/iso_week default to the current ISO week (KST). Returns the week meta plus a
    `cells` map keyed by "{user_id}:{day 0-4 Mon-Fri}:{plan|gap}".
    """
    if iso_year is None or iso_week is None:
        y, w, _ = _today_kst().isocalendar()
        iso_year, iso_week = y, w
    return await get_client().call_json(
        "GET", f"/api/scrum/{board_id}/weeks/{iso_year}/{iso_week}/cells")


@mcp.tool
async def write_scrum_daily(board_id: int, text: str, row: str = "plan",
                            day: int | None = None, mode: str = "replace",
                            iso_year: int | None = None, iso_week: int | None = None) -> Any:
    """Write YOUR OWN daily-scrum cell (the token owner's row).

    Defaults to today (KST): row='plan' (To Do; 'gap' = Recap), day = today's weekday
    (0=Mon..4=Fri), current ISO week. mode='replace' (default) overwrites the cell;
    'append' adds a paragraph. Empty text with replace clears the cell. Weekends have no
    cell — specify day (0-4) explicitly for a weekend write. v1 is plain text only.
    """
    y, w, wd = _today_kst().isocalendar()  # wd: 1=Mon..7=Sun
    if iso_year is None:
        iso_year = y
    if iso_week is None:
        iso_week = w
    if day is None:
        if wd >= 6:
            return {"error": "weekend",
                    "detail": "주말에는 데일리스크럼 셀이 없습니다. day(0=Mon..4=Fri)를 지정하세요."}
        day = wd - 1
    body = {"day": day, "row": row, "text": text, "mode": mode}
    return await get_client().call_json(
        "PATCH", f"/api/scrum/{board_id}/weeks/{iso_year}/{iso_week}/cells", json=body)


@mcp.tool
async def get_current_retro(board_id: int) -> Any:
    """Get-or-create the current period's retrospective doc (returns retro_id and period).

    For boards with a 'manual' retro cadence, retro is null (no auto retro). Use the
    returned retro_id with get_scrum_retro_cells / write_scrum_retro.
    """
    return await get_client().call_json("GET", f"/api/scrum/{board_id}/retros/current")


@mcp.tool
async def get_scrum_retro_cells(board_id: int, retro_id: int) -> Any:
    """Read a retrospective's KPT cells (per member × keep/problem/try) as plain text.

    Returns a `cells` map keyed by "{user_id}:{keep|problem|try}".
    """
    return await get_client().call_json(
        "GET", f"/api/scrum/{board_id}/retros/{retro_id}/cells")


@mcp.tool
async def write_scrum_retro(board_id: int, retro_id: int, key: str, text: str,
                            mode: str = "replace") -> Any:
    """Write YOUR OWN retrospective KPT cell (the token owner's row).

    key is 'keep', 'problem', or 'try'. mode='replace' (default) overwrites; 'append'
    adds a paragraph; empty text with replace clears the cell. v1 is plain text only.
    """
    body = {"key": key, "text": text, "mode": mode}
    return await get_client().call_json(
        "PATCH", f"/api/scrum/{board_id}/retros/{retro_id}/cells", json=body)


@mcp.tool
async def list_scrum_retros(board_id: int) -> Any:
    """List a board's past retrospectives (newest first)."""
    return await get_client().call_json("GET", f"/api/scrum/{board_id}/retros")
