from typing import Any

from .._app import mcp, get_client
from .._pagination import paginate


@mcp.tool
async def search_tasks(
    query: str,
    scope: str = "my",
    limit: int | None = None,
    offset: int | None = None,
) -> Any:
    """Full-text search tasks by keyword across branches.

    Use this as the primary way to find a task when you don't already have its id —
    far cheaper than listing every branch and matching client-side.
    scope: "my" (tasks you're involved in, the default) or "all" (every branch you
    can access). query is capped at 100 characters by the backend.

    Paginated client-side: returns the first `limit` matches (default 50) from `offset`,
    plus a "pagination" summary (total/returned/has_more). Refine the query for fewer hits.
    """
    result = await get_client().call_json(
        "GET", "/api/chat/task-search", params={"q": query, "mode": scope}
    )
    return paginate(result, "tasks", limit=limit, offset=offset)


@mcp.tool
async def search_docs(query: str, limit: int | None = None, offset: int | None = None) -> Any:
    """Full-text search Canvas docs/pages by keyword.

    The fastest way to locate a page when you don't have its canvas_id/page_id.
    query is capped at 100 characters by the backend.

    Paginated client-side: returns the first `limit` matches (default 50) from `offset`,
    plus a "pagination" summary (total/returned/has_more). Refine the query for fewer hits.
    """
    result = await get_client().call_json(
        "GET", "/api/chat/doc-search", params={"q": query}
    )
    return paginate(result, "docs", limit=limit, offset=offset)


@mcp.tool
async def search_issues(query: str, limit: int | None = None, offset: int | None = None) -> Any:
    """Full-text search task issues (sub-issues) by keyword.

    query is capped at 100 characters by the backend.

    Paginated client-side: returns the first `limit` matches (default 50) from `offset`,
    plus a "pagination" summary (total/returned/has_more). Refine the query for fewer hits.
    """
    result = await get_client().call_json(
        "GET", "/api/chat/issue-search", params={"q": query}
    )
    return paginate(result, "issues", limit=limit, offset=offset)
