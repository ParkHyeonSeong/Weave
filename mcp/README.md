# Weave MCP Server

Exposes Weave project-management tools (tasks, comments) to Claude sessions over MCP (stdio).
Talks to Weave's REST API only — the Weave backend is not modified.

## Tools
- `list_branches()` — list branches (projects); start here to get a `branch_id`
- `list_my_tasks(status?, priority?, branch_id?)` — your assigned tasks
- `get_task(branch_id, task_id)` — task detail
- `create_task(branch_id, title, description?, priority?, status?, due_date?)` — create a task
- `add_task_comment(branch_id, task_id, content)` — comment on a task

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
