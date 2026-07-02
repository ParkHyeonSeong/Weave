from typing import Any

from .._app import mcp, get_client, BranchRef
from .._pagination import paginate


@mcp.tool
async def get_current_user() -> Any:
    """Get the account this token acts as: {status, profile: {user_id, email, username, role}}.

    Call this to resolve "me"/"my" — e.g. before assigning a task to yourself,
    interpreting your own notifications/starred items, or checking whether you
    have the admin role. The token always acts as exactly this one user.
    """
    return await get_client().call_json("GET", "/api/auth/me")


@mcp.tool
async def list_branches() -> Any:
    """List all branches (projects) the account can access.

    You usually don't need this first: tools accept a branch's key (e.g. "WV") directly.
    Use it to discover branches, or when you only have a numeric id.
    Each branch includes:
    - progress_percent: completion of the current active sprint(s) (terminal/total),
      or null when the branch has no active sprint.
    - active_sprint_count; active_sprint_name (the name when exactly one sprint is
      active, else null); sprint_task_total: tasks in the active sprint(s).
    - active_task_count: open (non-terminal) top-level tasks in the branch.
    - a preview of its members.
    """
    return await get_client().call_json("GET", "/api/branches")


@mcp.tool
async def get_branch_home_stats() -> Any:
    """Get Branch home KPI aggregates across accessible branches.

    Returns open_count, in_progress_count, due_this_week_count and
    active_sprint_count.
    """
    return await get_client().call_json("GET", "/api/branches/home-stats")


@mcp.tool
async def get_branch(branch_id: BranchRef) -> Any:
    """Get a single branch's detail, including your role in it."""
    return await get_client().call_json("GET", f"/api/branches/{branch_id}")


@mcp.tool
async def create_branch(
    branch_name: str,
    key: str,
    description: str | None = None,
    visibility: str = "private",
) -> Any:
    """Create a new branch (project).

    key is REQUIRED: 2-10 uppercase letters/numbers starting with a letter
    (e.g. "CORE", "WEB2") — it's the task-number prefix, uppercased server-side.
    visibility is "private" (default) or "public".
    """
    body = {"branch_name": branch_name, "key": key, "visibility": visibility}
    body.update({k: v for k, v in {"description": description}.items() if v is not None})
    return await get_client().call_json("POST", "/api/branches", json=body)


@mcp.tool
async def update_branch(
    branch_id: BranchRef,
    branch_name: str | None = None,
    key: str | None = None,
    description: str | None = None,
    visibility: str | None = None,
    color: str | None = None,
    icon: str | None = None,
) -> Any:
    """Update a branch's metadata; only provided fields change. Admin-only.

    key (if set) is 2-10 uppercase alnum starting with a letter; visibility is
    "public"/"private"; color is #RRGGBB hex; icon is a "lucide:"/"emoji:"/"image:"
    prefixed string or a bare lucide name.
    """
    body = {k: v for k, v in {
        "branch_name": branch_name,
        "key": key,
        "description": description,
        "visibility": visibility,
        "color": color,
        "icon": icon,
    }.items() if v is not None}
    return await get_client().call_json("PATCH", f"/api/branches/{branch_id}", json=body)


@mcp.tool
async def delete_branch(branch_id: BranchRef) -> Any:
    """Archive (soft-delete) a branch. Reversible via restore_branch. Admin-only."""
    return await get_client().call_json("DELETE", f"/api/branches/{branch_id}")


@mcp.tool
async def restore_branch(branch_id: BranchRef) -> Any:
    """Restore an archived branch (see list_archived_branches). Admin-only."""
    return await get_client().call_json("POST", f"/api/branches/{branch_id}/restore")


@mcp.tool
async def leave_branch(branch_id: BranchRef) -> Any:
    """Leave a branch (remove yourself as a member); any member may leave.

    May return a category=business rejection (e.g. LAST_ADMIN / LAST_OWNER) if you are the branch's last admin.
    """
    return await get_client().call_json("POST", f"/api/branches/{branch_id}/leave")


@mcp.tool
async def join_branch(branch_id: BranchRef) -> Any:
    """Join a public branch as a member (discover candidates via list_public_branches)."""
    return await get_client().call_json("POST", f"/api/branches/{branch_id}/join")


@mcp.tool
async def list_archived_branches() -> Any:
    """List your archived branches (candidates for restore_branch)."""
    return await get_client().call_json("GET", "/api/branches/archived")


@mcp.tool
async def list_public_branches() -> Any:
    """List public branches you can discover and join (see join_branch)."""
    return await get_client().call_json("GET", "/api/branches/public")


@mcp.tool
async def list_branch_members(branch_id: BranchRef) -> Any:
    """List a branch's members (user_id, name, role).

    Use this to resolve a person's name to the user_id needed for task assignees
    or event participants.
    """
    return await get_client().call_json("GET", f"/api/branches/{branch_id}/members")


@mcp.tool
async def search_branch_non_members(branch_id: BranchRef, q: str = "") -> Any:
    """Search users who are NOT yet members of a branch (candidates to invite).

    q matches name/email.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/members/search", params={"q": q}
    )


@mcp.tool
async def add_branch_member(branch_id: BranchRef, user_id: int, role: str = "member") -> Any:
    """Add (invite) a user to a branch. role is "admin" or "member" (default).

    Resolve user_id via search_branch_non_members(branch_id). Admin-only — a
    non-admin caller gets a category=forbidden rejection (e.g. ADMIN_ONLY).
    """
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/members",
        json={"user_id": user_id, "role": role},
    )


@mcp.tool
async def update_branch_member_role(branch_id: BranchRef, user_id: int, role: str) -> Any:
    """Change a branch member's role. role is "admin" or "member". Admin-only."""
    return await get_client().call_json(
        "PATCH", f"/api/branches/{branch_id}/members/{user_id}", json={"role": role},
    )


@mcp.tool
async def remove_branch_member(branch_id: BranchRef, user_id: int) -> Any:
    """Remove a member from a branch. Admin-only."""
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/members/{user_id}",
    )


@mcp.tool
async def list_recent_views(limit: int | None = None, item_type: str | None = None) -> Any:
    """List the items you recently viewed, newest first.

    limit defaults to 10 (max 30). item_type optionally filters by kind (e.g. "task"
    or "doc"). Useful to orient to what you were last working on.
    """
    params = {k: v for k, v in {"limit": limit, "type": item_type}.items() if v is not None}
    return await get_client().call_json("GET", "/api/recent-views", params=params)


@mcp.tool
async def batch_ref_status(
    task_ids: list[int] | None = None,
    issue_ids: list[int] | None = None,
    page_ids: list[int] | None = None,
    user_ids: list[int] | None = None,
) -> Any:
    """Resolve many refs at once → their current titles/statuses (and usernames).

    Pass any combination of id lists; each is capped by the backend. Returns
    {tasks, issues, pages, users} maps keyed by id. Cheaper than one get_* per ref
    when hydrating several `[[...]]`-style references.
    """
    body = {
        "task_ids": task_ids or [],
        "issue_ids": issue_ids or [],
        "page_ids": page_ids or [],
        "user_ids": user_ids or [],
    }
    return await get_client().call_json("POST", "/api/ref-status", json=body)


@mcp.tool
async def list_my_tasks(
    status: str | None = None,
    priority: str | None = None,
    branch_id: BranchRef | None = None,
    status_category: str | None = None,
    sort_by: str | None = None,
    limit: int | None = None,
    offset: int | None = None,
) -> Any:
    """List tasks assigned to the account across branches.

    Optional filters: status, priority (low/medium/high/urgent), branch_id,
    status_category (todo/in_progress/done). sort_by is "updated" (default), "created",
    "priority", or "due_date". For complex filtering beyond these (AND/OR/NOT trees,
    operators, date ranges, custom fields) use query_tasks(scope="my").

    Paginated client-side: returns the first `limit` tasks (default 50) from `offset`,
    plus a "pagination" summary (total/returned/has_more). Page with offset to see the
    rest; narrow with the filters above when you can.
    """
    params = {
        k: v
        for k, v in {
            "status": status,
            "priority": priority,
            "branch_id": branch_id,
            "status_category": status_category,
            "sort_by": sort_by,
        }.items()
        if v is not None
    }
    result = await get_client().call_json("GET", "/api/my-tasks", params=params)
    return paginate(result, "tasks", limit=limit, offset=offset)
