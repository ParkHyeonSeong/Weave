from fastmcp import FastMCP

from .client import WeaveClient

INSTRUCTIONS = """\
Weave is a project-management app with 5 sub-apps: Branch (PM/tasks), Canvas (docs),
Track (cross-branch workflows), Schedule (calendar), and Scrum (weekly boards). These
tools drive it over Weave's REST API, acting as the token's owner.

Getting oriented:
- get_current_user() resolves "me"/"my" (the account the token acts as).
- Most tools need a branch_id — call list_branches() first. Likewise list_canvases(),
  list_tracks(), and list_scrum_boards() are the entry points for those apps.
- To find something when you don't have its id, use search_tasks / search_docs /
  search_issues instead of listing every branch.

Before creating or updating tasks:
- status and task_type are configured per branch — get valid values from
  list_workflow_statuses(branch_id) and list_task_types(branch_id).
- assignees (assignee_main/assignee_sub) and event participants are user ids — resolve
  names via list_branch_members(branch_id).

Conventions: ids are integers and dates are ISO YYYY-MM-DD. Every tool returns the API's
JSON on success, or a dict with an "error" key on failure — including
{"error": "business", "detail": ...} when the backend rejects an action (e.g. not a
member, or a change that would create a cycle), and {"error": "auth"} when the token is
invalid/expired (stop and surface this — retrying other tools won't help). Treat any
"error" key as failure, never as success."""

mcp = FastMCP("weave", instructions=INSTRUCTIONS)

_client: WeaveClient | None = None


def get_client() -> WeaveClient:
    global _client
    if _client is None:
        _client = WeaveClient()
    return _client
