"""Client-side pagination for the unbounded list/search tools.

Several Weave list endpoints (my-tasks, branch/epic tasks, track items, the
search endpoints) return their full result set with no limit/offset, so a busy
account can produce a payload large enough to blow the MCP client's token budget
— observed live: list_my_tasks at 57k+ characters (88 tasks). These tools slice the result
here and report what was withheld, so the model gets a bounded, honest page
instead of an overflow. Single-resource reads (get_*) are deliberately left
untouched: fetching one big doc is an explicit choice, not an accident.
"""
import json

DEFAULT_LIMIT = 50
# Safety budget (characters of the serialized page) kept under the MCP
# tool-result token limit, with headroom for CJK content that tokenizes dense.
MAX_PAGE_CHARS = 24000


def paginate(result, key, *, limit=None, offset=None):
    """Return a page of ``result[key]`` with a ``pagination`` summary attached.

    Error results and payloads without a list at ``key`` pass straight through
    untouched, so a backend ``{"error": {...}}`` or an unexpected shape is never
    mangled. Defaults to the first ``DEFAULT_LIMIT`` items; if that page would
    still exceed ``MAX_PAGE_CHARS`` it is shrunk further so a page of large
    items can't overflow the client either. Nothing is dropped silently — the
    summary always reports ``total`` and ``has_more``.
    """
    if not isinstance(result, dict) or not isinstance(result.get(key), list):
        return result

    items = result[key]
    total = len(items)
    start = offset if isinstance(offset, int) and offset > 0 else 0
    size = limit if isinstance(limit, int) and limit > 0 else DEFAULT_LIMIT
    page = items[start : start + size]

    size_capped = False
    while len(page) > 1 and len(json.dumps(page, ensure_ascii=False)) > MAX_PAGE_CHARS:
        page = page[: max(1, len(page) * 3 // 4)]
        size_capped = True

    paged = dict(result)
    paged[key] = page
    paged["pagination"] = {
        "total": total,
        "returned": len(page),
        "offset": start,
        "limit": size,
        "has_more": start + len(page) < total,
        "size_capped": size_capped,
    }
    return paged
