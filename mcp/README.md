# Weave MCP Server

Exposes Weave project-management tools (tasks, comments) to Claude sessions over MCP (stdio).
Talks to Weave's REST API only — the Weave backend is not modified.

## Tools
- `list_branches()` — list branches (projects); start here to get a `branch_id`
- `list_my_tasks(status?, priority?, branch_id?)` — your assigned tasks
- `get_task(branch_id, task_id)` — task detail
- `create_task(branch_id, title, description?, priority?, status?, due_date?)` — create a task
- `add_task_comment(branch_id, task_id, content)` — comment on a task

## Setup
1. Create a dedicated Weave service account (e.g. register `mcp-bot@example.com`).
2. `cp mcp/.env.example mcp/.env` and fill in `WEAVE_BASE_URL`, `WEAVE_SVC_EMAIL`, `WEAVE_SVC_PASSWORD`.
3. `python3 -m venv mcp/.venv && mcp/.venv/bin/pip install -e "./mcp[dev]"`
4. Register the server in the repo-root `.mcp.json` (note: `.mcp.json` is git-ignored, so this stays local to your machine — each clone must add it):
   ```json
   "weave": { "command": "mcp/.venv/bin/weave-mcp" }
   ```
   Then restart your MCP client to pick it up.

## Test
```bash
mcp/.venv/bin/python -m pytest mcp/tests -v
```

## Auth model
One `httpx.AsyncClient` logs in with the service-account credentials, caches the `weave_token`
cookie, reuses it until it expires (24h), and re-logs-in once on any HTTP 401. Secrets live only
in `mcp/.env` (git-ignored).

**Important — Secure cookie / HTTP:** The Weave backend marks the `weave_token` cookie `Secure` unless it runs with `DEBUG=true`. A `Secure` cookie is not sent back over plain `http://`, so every call would return 401. To use this server, either run the Weave backend with `DEBUG=true` (non-Secure cookie, fine for local dev) or point `WEAVE_BASE_URL` at an `https://` Weave. 
