"""Resolve a branch reference (numeric id or branch key) to a numeric branch_id.

A `BranchRef` is `int | str`: a numeric id (`12`), a digit string (`"12"`), or a
branch key (`"WV"`). Keys are matched against the caller's accessible branches
(`GET /api/branches`), so an unknown OR inaccessible key resolves to not_found —
no existence leak, no IDOR. `branch_name` is never resolved (it is not unique).
"""
import re

from . import errors as E

BranchRef = int | str

# Branch key format — identical to the backend constraint (^[A-Z][A-Z0-9]{1,9}$).
_KEY_RE = re.compile(r"^[A-Z][A-Z0-9]{1,9}$")


async def resolve_branch_ref(value, client):
    """Return (branch_id, None) on success or (None, error_envelope) on failure.

    `client` must expose `async call_json(method, path)`. A list-branches transport
    failure (auth/network/...) is propagated unchanged.
    """
    # bool is an int subclass — reject it explicitly alongside other non-id/key types
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        return None, E.make_error(
            "validation", code=E.INVALID_BRANCH_REF,
            message=f"branch_id must be a numeric id or a branch key, got {value!r}")
    if isinstance(value, int):
        return value, None

    s = value.strip()
    if s.isdecimal():
        return int(s), None

    key = s.upper()
    if not _KEY_RE.match(key):
        return None, E.make_error(
            "validation", code=E.INVALID_BRANCH_REF,
            message=f"{value!r} is not a valid branch id or key")

    body = await client.call_json("GET", "/api/branches")
    if isinstance(body, dict) and "error" in body:
        return None, body  # propagate the list-branches failure unchanged

    items = body.get("branches") if isinstance(body, dict) else body
    if not isinstance(items, list):
        items = []
    for b in items:
        if isinstance(b, dict) and str(b.get("key", "")).upper() == key:
            if b.get("branch_id") is not None:
                return b["branch_id"], None

    return None, E.make_error(
        "not_found", code=E.BRANCH_KEY_NOT_FOUND,
        message=f"No accessible branch with key {key!r}")
