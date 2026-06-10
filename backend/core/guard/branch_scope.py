"""Shared authorization guard for cross-branch IDOR protection.

A single place to verify that a resource actually belongs to a given branch
before a controller acts on it (supported resource_type values are the keys of
``_RESOURCE_QUERIES``). Generalizes the ``delete_status`` pattern in
``core/controller/workflow_status.py``.

This guard verifies ONLY that a resource belongs to the given branch/scope. It
does NOT filter archived/soft-deleted state — callers must handle archived
visibility themselves (e.g. canvas restore / permanent-delete handlers
legitimately target archived rows, so the guard must still return them).

Controllers/models return dicts (not HTTPExceptions) and never commit — this
helper only runs SELECTs and follows the same convention.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# Per resource_type: (base SELECT, branch-scope WHERE clause).
# `{branch}` is appended only when a branch_id is supplied; when branch_id is
# None the resource is fetched unscoped and its own branch_id is returned so
# the caller can run its own membership check (see star.py / track.py sites).
_RESOURCE_QUERIES = {
    'workflow_status': (
        "SELECT workflow_status_id, branch_id, key, label, color, category, "
        "sort_order, is_default "
        "FROM workflow_status WHERE workflow_status_id = :id",
        " AND branch_id = :branch_id",
    ),
    'task_type': (
        "SELECT type_id, branch_id, type_key, type_name, icon, color, "
        "sort_order, created_at "
        "FROM task_type_config WHERE type_id = :id",
        " AND branch_id = :branch_id",
    ),
    'sprint': (
        "SELECT sprint_id, branch_id, sprint_name, goal, start_date, end_date, "
        "status, sort_order, created_by, created_at "
        "FROM sprint WHERE sprint_id = :id",
        " AND branch_id = :branch_id",
    ),
    'task': (
        "SELECT task_id, branch_id, display_number, title, description, "
        "task_type, status, priority, epic_id, sprint_id, parent_task_id, "
        "start_date, due_date, sort_order, created_by, created_at, updated_at "
        "FROM task WHERE task_id = :id",
        " AND branch_id = :branch_id",
    ),
    'epic': (
        "SELECT epic_id, branch_id, epic_name, description, status, color, "
        "start_date, due_date, sort_order, created_by, created_at, updated_at "
        "FROM epic WHERE epic_id = :id",
        " AND branch_id = :branch_id",
    ),
    'canvas': (
        "SELECT canvas_id, branch_id, canvas_name, key, description, icon, "
        "color, visibility, is_archived, created_by "
        "FROM canvas WHERE canvas_id = :id",
        " AND branch_id = :branch_id",
    ),
    # canvas_page is scoped to a branch through its parent canvas. Keeping this
    # JOIN here means callers never have to hand-write the page->canvas->branch
    # hop, and the returned dict exposes both canvas_id and branch_id.
    'canvas_page': (
        "SELECT p.page_id, p.canvas_id, p.parent_page_id, p.title, p.type, "
        "p.position, p.is_archived, c.branch_id "
        "FROM canvas_page p "
        "INNER JOIN canvas c ON p.canvas_id = c.canvas_id "
        "WHERE p.page_id = :id",
        " AND c.branch_id = :branch_id",
    ),
}


async def find_resource_in_branch(
    resource_id: int,
    branch_id: int | None,
    resource_type: str,
    db: AsyncSession,
) -> dict | None:
    """Fetch a resource scoped to a branch, returning the resource row.

    Args:
        resource_id: id of the target resource (status_id, type_id, sprint_id,
            task_id, epic_id, canvas_id, page_id).
        branch_id: branch the request is scoped to. When None, the branch
            filter is skipped and the resource is fetched unscoped so the
            caller can read its ``branch_id`` and check membership itself.

            WARNING: ``branch_id=None`` is ONLY for intentional unscoped fetches
            where the caller does its OWN membership check after reading the
            returned ``branch_id``. Normal scope checks MUST pass a real
            ``branch_id`` — passing None deliberately bypasses cross-branch
            protection and will happily return a resource from another branch.
        resource_type: supported values are the keys of ``_RESOURCE_QUERIES``.
        db: AsyncSession.

    Returns:
        The resource as a dict if it exists (and belongs to ``branch_id`` when
        one is given); otherwise None. Never raises for the not-found /
        cross-branch / unsupported-type cases. This is a PURE branch-scope
        check: it does NOT filter archived/soft-deleted rows — that is the
        caller's responsibility.
    """
    spec = _RESOURCE_QUERIES.get(resource_type)
    if spec is None:
        return None

    base_query, scope_clause = spec
    params = {'id': resource_id}
    query = base_query
    if branch_id is not None:
        query += scope_clause
        params['branch_id'] = branch_id

    result = await db.execute(text(query), params)
    row = result.fetchone()
    if row is None:
        return None
    return dict(row._mapping)
