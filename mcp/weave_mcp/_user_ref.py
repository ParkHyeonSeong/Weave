"""Resolve user references (numeric id, digit string, "me"/"$me", email, or username)
to numeric user ids before a tool runs.

A `UserRef` is `int | str`. String refs are resolved against the branch's member list
(`GET /api/branches/{branch_id}/members`), so a non-member resolves to not_found
whether or not the user exists — no existence leak. email (contains "@") matches
exact case-insensitive; username matches exact. Neither is guaranteed unique here:
username has no DB unique constraint at all, and email's unique constraint is
case-SENSITIVE (no lower-normalization on input), so case-variant duplicates can
coexist. Any 2+ matches — email or username — are a hard USER_REF_AMBIGUOUS error,
never a silent first match. "me"/"$me" resolves via `GET /api/auth/me`. Lists resolve
atomically: one bad element fails the whole call before any backend mutation.
"""
from typing import NamedTuple

from . import errors as E
from ._branch_ref import _ID_RE  # single source for the digit-string rule

UserRef = int | str

_ME_KEYWORDS = frozenset({"me", "$me"})


class UserRefSpec(NamedTuple):
    scalars: tuple[str, ...] = ()
    lists: tuple[str, ...] = ()


# tool name -> params carrying user refs. Kept in sync with the tool signatures by
# the registry↔schema sweep in tests/test_user_ref_ingress.py.
USER_REF_PARAMS: dict[str, UserRefSpec] = {
    "create_task":           UserRefSpec(scalars=("assignee_main",), lists=("assignee_sub",)),
    "update_task":           UserRefSpec(scalars=("assignee_main",), lists=("assignee_sub",)),
    "add_task_assignee":     UserRefSpec(scalars=("user_id",)),
    "remove_task_assignee":  UserRefSpec(scalars=("user_id",)),
    "create_schedule_event": UserRefSpec(lists=("participant_ids",)),
    "update_schedule_event": UserRefSpec(lists=("participant_ids",)),
}


def _needs_resolution(args, spec):
    """True when any registered param carries a non-int value (bool counts as non-int)."""
    for name in spec.scalars:
        v = args.get(name)
        if v is not None and type(v) is not int:
            return True
    for name in spec.lists:
        v = args.get(name)
        if isinstance(v, list) and any(type(x) is not int for x in v):
            return True
    return False


def _classify(ref):
    """-> ("id", int) | ("me", None) | ("email", str) | ("username", str) | ("invalid", None)."""
    if isinstance(ref, bool) or not isinstance(ref, (int, str)):
        return "invalid", None
    if isinstance(ref, int):
        return "id", ref
    s = ref.strip()
    if not s:
        return "invalid", None
    if _ID_RE.fullmatch(s):
        return "id", int(s)
    if s.lower() in _ME_KEYWORDS:
        return "me", None
    if "@" in s:
        return "email", s.lower()
    return "username", s


async def _fetch_members(branch_id, client):
    """Return (member rows, None) or (None, error envelope). branch_id is already
    numeric here — BranchRefResolver runs before UserRefResolver."""
    if type(branch_id) is not int:
        return None, E.make_error(
            "validation", code=E.INVALID_USER_REF,
            message="cannot resolve user references without a valid branch_id")
    body = await client.call_json("GET", f"/api/branches/{branch_id}/members")
    if isinstance(body, dict) and "error" in body:
        return None, body  # propagate the transport/API failure unchanged
    items = body.get("members") if isinstance(body, dict) else body
    return (items if isinstance(items, list) else []), None


async def _fetch_me(client):
    """Return (user_id, None) or (None, error envelope) from GET /api/auth/me."""
    body = await client.call_json("GET", "/api/auth/me")
    if isinstance(body, dict) and "error" in body:
        return None, body
    profile = body.get("profile") if isinstance(body, dict) else None
    user_id = profile.get("user_id") if isinstance(profile, dict) else None
    if isinstance(user_id, bool) or not isinstance(user_id, int):
        return None, E.make_error(
            "server", message="could not resolve 'me': /api/auth/me returned no user_id")
    return user_id, None


def _match_member(kind, needle, label, members):
    """Exact-match one email/username needle against the member rows."""
    matches = []
    for m in members:
        if not isinstance(m, dict) or m.get("user_id") is None:
            continue
        value = m.get("email") if kind == "email" else m.get("username")
        if not isinstance(value, str):
            continue
        value = value.strip()
        matched = (value.lower() == needle) if kind == "email" else (value == needle)
        if matched:
            matches.append(m)
    if not matches:
        return None, E.make_error(
            "not_found", code=E.USER_REF_NOT_FOUND,
            message=f"{label}={needle!r} does not match any member of this branch")
    if len(matches) > 1:
        # email unique는 case-sensitive라 case-변형 중복(Alice@x/alice@x)이 공존 가능 —
        # email 모호성에는 "email을 쓰라"는 힌트가 모순이므로 kind별로 안내를 가른다.
        alt = "a user id" if kind == "email" else "a user id or email"
        return None, E.make_error(
            "validation", code=E.USER_REF_AMBIGUOUS,
            message=(f"{label}={needle!r} is ambiguous among {len(matches)} members"
                     f" — pass {alt} instead"),
            detail=[{"user_id": m["user_id"], "username": m.get("username")}
                    for m in matches])
    return matches[0]["user_id"], None


async def resolve_user_refs(tool_name, args, client):
    """Resolve every registered user-ref param of `tool_name` in `args`, in place.

    Returns None on success (args mutated) or an error envelope (args untouched).
    All string refs of one call share a single members fetch; /api/auth/me is
    fetched once only when a "me" ref is present; all-int calls make no HTTP calls.
    """
    spec = USER_REF_PARAMS.get(tool_name)
    if spec is None or not isinstance(args, dict) or not _needs_resolution(args, spec):
        return None

    # Stage copies so a failure leaves args untouched (atomic).
    staged = {}
    items = []  # (param, index | None, ref)
    for name in spec.scalars:
        if args.get(name) is not None:
            staged[name] = args[name]
            items.append((name, None, args[name]))
    for name in spec.lists:
        if isinstance(args.get(name), list):
            staged[name] = list(args[name])
            items.extend((name, i, v) for i, v in enumerate(staged[name]))

    classified = []
    for param, idx, ref in items:
        kind, payload = _classify(ref)
        label = f"{param}[{idx}]" if idx is not None else param
        if kind == "invalid":
            return E.make_error(
                "validation", code=E.INVALID_USER_REF,
                message=f"{label}={ref!r} is not a valid user id, email, username, or 'me'")
        classified.append((param, idx, label, kind, payload))

    members = None
    if any(kind in ("email", "username") for _, _, _, kind, _ in classified):
        members, err = await _fetch_members(args.get("branch_id"), client)
        if err is not None:
            return err
    me_id = None
    if any(kind == "me" for _, _, _, kind, _ in classified):
        me_id, err = await _fetch_me(client)
        if err is not None:
            return err

    for param, idx, label, kind, payload in classified:
        if kind == "id":
            resolved = payload
        elif kind == "me":
            resolved = me_id
        else:
            resolved, err = _match_member(kind, payload, label, members)
            if err is not None:
                return err
        if idx is None:
            staged[param] = resolved
        else:
            staged[param][idx] = resolved

    args.update(staged)
    return None
