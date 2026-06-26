from datetime import datetime, timedelta, timezone
from typing import Any

from .. import errors as E
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
async def create_scrum_board(
    name: str,
    icon: str | None = None,
    color: str | None = None,
    visibility: str | None = None,
    retro_cadence: str | None = None,
    retro_interval_weeks: int | None = None,
    retro_template: str | None = None,
    retro_anchor_weekday: int | None = None,
) -> Any:
    """Create a new Scrum board (weekly daily-scrum + retro); you become its admin.

    Only name is required. color is #RRGGBB hex (default #16A34A). visibility is
    "private" (default) or "public". retro_cadence is "weekly" (default), "biweekly",
    "every_n_weeks", "monthly", or "manual"; retro_interval_weeks sets N for
    "every_n_weeks". retro_template is "kpt". retro_anchor_weekday is 0..4 (Mon..Fri,
    default 4=Fri) — the day a retro period closes. Omitted fields take server defaults.
    """
    body = {"name": name}
    body.update({k: v for k, v in {
        "icon": icon,
        "color": color,
        "visibility": visibility,
        "retro_cadence": retro_cadence,
        "retro_interval_weeks": retro_interval_weeks,
        "retro_template": retro_template,
        "retro_anchor_weekday": retro_anchor_weekday,
    }.items() if v is not None})
    return await get_client().call_json("POST", "/api/scrum", json=body)


@mcp.tool
async def update_scrum_board(
    board_id: int,
    name: str | None = None,
    icon: str | None = None,
    color: str | None = None,
    visibility: str | None = None,
    retro_cadence: str | None = None,
    retro_interval_weeks: int | None = None,
    retro_template: str | None = None,
    retro_anchor_weekday: int | None = None,
) -> Any:
    """Update a Scrum board's config; only provided fields change. Admin-only.

    Same field rules/enums as create_scrum_board (cadence, template, 0..4 weekday).
    """
    body = {k: v for k, v in {
        "name": name,
        "icon": icon,
        "color": color,
        "visibility": visibility,
        "retro_cadence": retro_cadence,
        "retro_interval_weeks": retro_interval_weeks,
        "retro_template": retro_template,
        "retro_anchor_weekday": retro_anchor_weekday,
    }.items() if v is not None}
    return await get_client().call_json("PATCH", f"/api/scrum/{board_id}", json=body)


@mcp.tool
async def delete_scrum_board(board_id: int) -> Any:
    """Archive (soft-delete) a Scrum board. Reversible via restore_scrum_board. Admin-only."""
    return await get_client().call_json("DELETE", f"/api/scrum/{board_id}")


@mcp.tool
async def restore_scrum_board(board_id: int) -> Any:
    """Restore an archived Scrum board (see list_archived_scrum_boards). Admin-only."""
    return await get_client().call_json("POST", f"/api/scrum/{board_id}/restore")


@mcp.tool
async def leave_scrum_board(board_id: int) -> Any:
    """Leave a Scrum board (remove yourself as a member); any member may leave.

    May return a category=business rejection (e.g. LAST_ADMIN / LAST_OWNER) if you are the board's last admin.
    """
    return await get_client().call_json("POST", f"/api/scrum/{board_id}/leave")


@mcp.tool
async def list_archived_scrum_boards() -> Any:
    """List your archived Scrum boards (candidates for restore_scrum_board)."""
    return await get_client().call_json("GET", "/api/scrum/archived")


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
            return E.make_error(
                "validation", code=E.WEEKEND_NO_CELL,
                message="주말에는 데일리스크럼 셀이 없습니다. day(0=Mon..4=Fri)를 지정하세요.")
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


@mcp.tool
async def list_scrum_members(board_id: int) -> Any:
    """List a Scrum board's members (user_id, name, role).

    Resolve a person's name to the user_id needed by the member-write tools.
    (get_scrum_board also embeds the member list.)
    """
    return await get_client().call_json("GET", f"/api/scrum/{board_id}/members")


@mcp.tool
async def search_scrum_non_members(board_id: int, q: str = "") -> Any:
    """Search users who are NOT yet members of a Scrum board (candidates to invite).

    q matches name/email.
    """
    return await get_client().call_json(
        "GET", f"/api/scrum/{board_id}/members/search", params={"q": q}
    )


@mcp.tool
async def add_scrum_member(board_id: int, user_id: int, role: str = "member") -> Any:
    """Add (invite) a user to a Scrum board. role is "admin" or "member" (default).

    Resolve user_id via search_scrum_non_members(board_id). Admin-only.
    """
    return await get_client().call_json(
        "POST", f"/api/scrum/{board_id}/members",
        json={"user_id": user_id, "role": role},
    )


@mcp.tool
async def update_scrum_member_role(board_id: int, user_id: int, role: str) -> Any:
    """Change a Scrum board member's role. role is "admin" or "member". Admin-only."""
    return await get_client().call_json(
        "PATCH", f"/api/scrum/{board_id}/members/{user_id}", json={"role": role}
    )


@mcp.tool
async def remove_scrum_member(board_id: int, user_id: int) -> Any:
    """Remove a member from a Scrum board. Admin-only."""
    return await get_client().call_json(
        "DELETE", f"/api/scrum/{board_id}/members/{user_id}"
    )
