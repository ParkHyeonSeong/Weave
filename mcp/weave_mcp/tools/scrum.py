from typing import Any

from .._app import mcp, get_client


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
