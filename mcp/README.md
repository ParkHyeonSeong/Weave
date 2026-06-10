# Weave MCP Server

Exposes Weave project-management tools (tasks, sprints, epics, issues, docs, and more) to
Claude sessions over MCP (stdio). Talks to Weave's REST API only — the Weave backend is not
modified. Each tool acts as the token's owner; `?` marks optional arguments.

## Tools (59)

> The authoritative, always-current description of each tool is its docstring in
> `weave_mcp/tools/*.py` (that's what the model reads). This list is the human-readable overview.

**Branches & your work**
- `get_current_user()` — the account this token acts as (user_id, email, username, role); resolves "me"/"my"
- `list_branches()` — list branches (projects); call first to get a `branch_id`
- `get_branch_home_stats()` — open / in-progress / due-this-week / active-sprint counts across your branches
- `list_my_tasks(status?, priority?, branch_id?)` — your assigned tasks across branches

**Search** (keyword lookup — find ids without listing everything; `query` capped at 100 chars)
- `search_tasks(query, scope?)` — `scope`: "my" (default) | "all"
- `search_docs(query)` · `search_issues(query)`

**Tasks**
- `list_branch_tasks(branch_id, sprint_id?)` — all tasks in a branch
- `get_task(branch_id, task_id)` — full task detail
- `create_task(branch_id, title, description?, priority?, status?, due_date?)` — create a task
- `update_task(branch_id, task_id, title?, description?, status?, priority?, sprint_id?, epic_id?, start_date?, due_date?, label_ids?)` — update a task
- `delete_task(branch_id, task_id)` — delete a task

**Task comments**
- `list_task_comments(branch_id, task_id)`
- `add_task_comment(branch_id, task_id, content)`
- `update_task_comment(branch_id, task_id, comment_id, content)`
- `delete_task_comment(branch_id, task_id, comment_id)`

**Issues** (sub-issues under a task)
- `list_task_issues(branch_id, task_id)` · `get_task_issue(branch_id, task_id, issue_id)`
- `create_task_issue(branch_id, task_id, title, body?)`
- `update_task_issue(branch_id, task_id, issue_id, title?, body?, status?)`
- `delete_task_issue(branch_id, task_id, issue_id)`

**Dependencies**
- `list_task_dependencies(branch_id, task_id)`
- `create_dependency(branch_id, source_task_id, target_task_id, dep_type?)` — `dep_type`: finish_to_start | relates_to
- `delete_dependency(branch_id, dependency_id)`

**Sprints**
- `list_sprints(branch_id)`
- `create_sprint(branch_id, sprint_name, goal?, start_date?, end_date?)`
- `update_sprint(branch_id, sprint_id, sprint_name?, goal?, start_date?, end_date?, status?)`
- `delete_sprint(branch_id, sprint_id)` · `start_sprint(branch_id, sprint_id)`
- `complete_sprint(branch_id, sprint_id, move_to?)` — `move_to`: "backlog" or a sprint id

**Epics**
- `list_epics(branch_id)` · `get_epic(branch_id, epic_id)`
- `create_epic(branch_id, epic_name, description?, status?, color?, start_date?, due_date?)`
- `update_epic(branch_id, epic_id, epic_name?, description?, status?, color?, start_date?, due_date?)`
- `delete_epic(branch_id, epic_id)`

**Branch config** (read — the valid values for task fields)
- `list_labels(branch_id)` · `list_workflow_statuses(branch_id)` · `list_task_types(branch_id)`

**Canvas (docs)**
- `list_canvases()` · `get_canvas_page_tree(canvas_id)` · `get_canvas_page(canvas_id, page_id)`
- `get_canvas_home_stats()` — total-docs / edited-this-week / starred counts across your canvases
- `create_canvas_page(canvas_id, title, content?, parent_page_id?)`
- `update_canvas_page(canvas_id, page_id, title?, content?)` — `content` replaces the whole page body

**Tracks** (cross-branch workflows)
- `list_tracks()` — your tracks, each with `progress_percent`, item/branch/member counts and a linked-branch preview
- `get_track(track_id)` · `get_track_home_stats()` — active-track / connected-branch / in-progress / due-this-week counts
- `list_track_branches(track_id)` · `list_track_items(track_id)`

**Notifications & stars**
- `list_notifications()` · `mark_notification_read(notification_id)` · `list_starred(item_type?)`

**Schedule** (branch calendar)
- `list_schedule_events(branch_id, range_start, range_end)` — `range_start`/`range_end` are required ISO dates
- `create_schedule_event(branch_id, title, start_date, end_date?, description?, color?, participant_ids?)`
- `update_schedule_event(branch_id, event_id, title?, start_date?, end_date?, description?, color?, participant_ids?)`
- `delete_schedule_event(branch_id, event_id)`

**Scrum** (weekly daily-scrum + retro boards)
- `list_scrum_boards()` — call first to get a `board_id`
- `get_scrum_board(board_id)` — board metadata only; daily-scrum/retro content is real-time (Yjs) and not over REST
- `get_scrum_home_cards()` — cross-board cards (today's unwritten daily-scrum, due retros)

## Use it (recommended — no clone needed)

Requires [`uv`](https://docs.astral.sh/uv/). Add this to your MCP client's `.mcp.json` and restart it:

```jsonc
{
  "mcpServers": {
    "weave": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/your-org/Weave#subdirectory=mcp", "weave-mcp"],
      "env": {
        "WEAVE_BASE_URL": "https://weave.example.com",
        "WEAVE_API_TOKEN": "${WEAVE_API_TOKEN}"
      }
    }
  }
}
```

`uvx` fetches and runs the server in an isolated environment — no clone, no venv, no `.env` file. Credentials come from the `env` block. Create a Personal Access Token in Weave (Profile → Personal Access Tokens), then put it in `WEAVE_API_TOKEN` — here, or in your shell env referenced via `${WEAVE_API_TOKEN}`.

## Local development

For working on the server itself:

1. `cp mcp/.env.example mcp/.env` and fill in `WEAVE_BASE_URL` and `WEAVE_API_TOKEN`.
2. `python3 -m venv mcp/.venv && mcp/.venv/bin/pip install -e "./mcp[dev]"`
3. Register it in the repo-root `.mcp.json` (git-ignored, so it stays local to your machine):
   ```json
   "weave": { "command": "mcp/.venv/bin/weave-mcp" }
   ```
   Then restart your MCP client to pick it up.

## Test
```bash
mcp/.venv/bin/python -m pytest mcp/tests -v
```

## Auth model
The client sends a Weave Personal Access Token as an `Authorization: Bearer` header on every
request. Tokens are long-lived and revocable (revoke in the Weave UI), so there is no login,
cookie, or session refresh. An invalid/revoked/expired token returns a 401, surfaced as an
`{"error": 401}` result. The token lives only in `WEAVE_API_TOKEN` (env / git-ignored `mcp/.env`).
