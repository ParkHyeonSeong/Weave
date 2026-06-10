<p align="center">
  <img src="frontend/public/icons/weave_square.svg" alt="Weave" width="80" />
</p>

<h1 align="center">Weave</h1>

<p align="center">
  Open-source work platform — self-hostable project management, docs, chat, and AI in one place.
</p>

<p align="center">
  <a href="#features">Features</a> · <a href="#quick-start">Quick Start</a> · <a href="#weave-mcp-server">MCP Server</a> · <a href="#tech-stack">Tech Stack</a> · <a href="#contributing">Contributing</a>
</p>

---

## Why Weave?

Most teams stitch together Jira for tasks, Confluence for docs, and Slack for chat — three tools, three logins, three places to lose context. Weave combines **project management, real-time documentation, team chat, and an AI assistant** into a single self-hosted platform that you fully own.

- **No per-seat pricing.** Host it yourself, invite your whole team.
- **All-in-one.** Tasks, docs, chat, and AI in one place — no more context switching.
- **Yours to own.** Your data stays on your server. One `make up-build` and you're running.

## Features

### 📋 Task Management
Organize work with a flexible task system inspired by Linear, scoped per project ("branch").

- **Kanban Board** — drag-and-drop cards across custom workflow columns
- **Sprints** — plan iterations, activate, and complete (carrying over unfinished work)
- **Epics & Timeline** — Gantt-style roadmap across weeks, months, or quarters, with sprints overlaid
- **Flow View** — visualize tasks and their dependencies as an interactive node graph
- **Custom Task Types, Fields & Statuses** — define your own per project
- **Labels, Priorities & Dependencies** — categorize, prioritize, and link tasks (blocking/relates-to, even across projects)
- **Issues** — track sub-issues/bugs under a task, each with its own thread
- **Comments & Activity Log** — rich threaded comments plus a full audit trail of every change
- **Filtering & My Tasks** — filter by status, assignee, label, priority, type; personal cross-project task view
- **Archive** — completed and cancelled tasks kept out of the way but searchable

### 🔗 Tracks
A higher-order view that pulls tasks from **multiple projects** into one shared workflow — perfect for cross-team initiatives and release trains.

- **Flow** — cross-branch dependency graph
- **Timeline** — Gantt chart grouped by project
- **Tree** — hierarchical outline sorted by due date
- **Bulk Add** — pull in tasks by epic, sprint, or filter in one go

### 📝 Canvas (Documentation)
A real-time collaborative knowledge base built on TipTap + Yjs, replacing Confluence.

- **Live Collaboration** — multiple people edit the same page simultaneously, with presence avatars (CRDT-based, native Python Yjs server)
- **Rich Text Editor** — headings, tables (with cell colors), code blocks with syntax highlighting, math (KaTeX), callouts, multicolor text/highlight
- **Mermaid Diagrams** — write diagrams-as-code with live preview
- **Typst Editor** — author and render Typst documents, export to PDF
- **Bookmarks & Link Previews** — paste a URL to get a rich preview card
- **Inline References** — link tasks, docs, and issues inline with live hover previews
- **Inline Annotations** — highlight text and leave anchored comment threads
- **Markdown Paste** — paste markdown and it auto-converts to rich text
- **Page Hierarchy** — nested pages with drag-and-drop reordering and per-page activity history
- **Images** — paste, drag-and-drop, or upload (validated by magic bytes)

### 💬 Messenger (Real-time Chat)
Built-in team communication over WebSocket.

- **Direct & Group Messages** with full, paginated history
- **Mentions & References** — `@mention` people; attach tasks, docs, and issues via `/` commands
- **File Attachments** — images and documents (up to 10 files / 10 MB each)
- **Read Receipts & Presence** — see who's read messages and who's online
- **Picture-in-Picture** — pop the messenger out into a floating window

### 🏠 Home & Launchpad
A personal landing page that adapts to how you work.

- **Customizable Widgets** — My Tasks, Active Sprints, Recent, Starred — drag to add, remove, and reorder (saved locally)
- **Launchpad & Quick Create** — jump into Branches, Canvases, and Tracks, or create anything from anywhere

### 🤖 AI Assistant
An in-app AI chat that knows your work.

- **Conversational assistant** with streaming responses and saved conversation history
- **Task-aware** — the assistant is given a live summary of your tasks
- **Pluggable providers** — Anthropic (Claude) or OpenAI, configured by an admin (API key stored encrypted)
- See also the [Weave MCP Server](#weave-mcp-server) to drive Weave from Claude itself

### 📅 Schedule
A project calendar for planning and tracking.

- **Calendar View** with sprint bars overlaid across weeks
- **Event–Task Linking** — connect meetings and milestones to tasks

### ⚡ Productivity & Platform
- **PWA** — install Weave as a native-feeling app on desktop and mobile, with an offline page
- **Notifications** — real-time in-app feed plus background **Web Push** (works when the browser is closed)
- **Command Palette** — `⌘K` to navigate, create, or search tasks/docs/issues/people at once
- **Stars & Recents** — bookmark items and jump back to recent activity
- **Browse & Discover** — find and join public projects and canvases
- **Jira Migration** — import projects from a Jira CSV export with user mapping

### 🔧 Administration
- **Setup Wizard** — guided first-run config (workspace name, registration policy, admin account)
- **User Management** — approve/reject registrations, assign roles, force password resets
- **Registration Policies** — open signup or invite-only (admin approval)
- **Integrations** — configure the AI provider and SMTP email from admin settings

## Weave MCP Server

Weave ships an optional **[MCP (Model Context Protocol)](https://modelcontextprotocol.io) server** so you can drive Weave from AI clients like Claude — manage tasks, sprints, epics, issues, dependencies, and docs straight from a chat session.

- **86 tools** across branches & members, tasks (incl. assignees), comments, issues, dependencies, sprints, epics, branch config, Canvas docs (pages & annotations), tracks (items & links), schedule, scrum, search, identity, home KPIs, and notifications — see [`mcp/README.md`](mcp/README.md) for the full list
- Talks to Weave over its REST API only — **no backend changes required**
- Runs locally over stdio; authenticates with a Weave Personal Access Token (Bearer)

Quickest way for a teammate to add it (requires [`uv`](https://docs.astral.sh/uv/)):

```jsonc
// .mcp.json
{
  "mcpServers": {
    "weave": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/your-org/Weave#subdirectory=mcp", "weave-mcp"],
      "env": {
        "WEAVE_BASE_URL": "https://weave.example.com",
        "WEAVE_API_TOKEN": "wv_your_token_here"
      }
    }
  }
}
```

See [`mcp/README.md`](mcp/README.md) for setup, the auth model, and local development.

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Docker Engine 24+ with Compose V2)

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/your-org/Weave.git
cd Weave

# 2. Create environment file
cp .env.example .env

# 3. Build and start (migrations run automatically)
make up-build

# 4. (Optional) Generate VAPID keys for push notifications
make generate-vapid
# Add the output to your .env file, then restart:
make restart
```

That's it. Open [http://localhost:3000](http://localhost:3000) and follow the setup wizard.

### Useful Commands

```bash
make up             # Start all services
make down           # Stop all services
make logs           # Tail all logs
make logs-backend   # Tail backend logs only
make db-shell       # Open PostgreSQL shell
make clean          # Stop and remove all data
make help           # Show all available commands
```

### Services

| Service    | Default URL                            |
|------------|----------------------------------------|
| Frontend   | http://localhost:3000                  |
| Backend    | http://localhost:8000                  |
| API Docs   | http://localhost:8000/api/docs (dev only) |
| PostgreSQL | localhost:5432                         |

> Ports are configurable via `.env`. API Docs (Swagger UI) is only available when `DEBUG=true`.

## Security

Weave includes the following built-in security measures:

- **SSRF Protection** — URL metadata fetching validates DNS-resolved IPs at every redirect hop, blocking internal networks and cloud metadata endpoints
- **Rate Limiting** — login, registration, and API endpoints are rate-limited per IP
- **XSS Prevention** — user-generated HTML is sanitized before rendering; SVG uploads are sanitized
- **File Upload Validation** — image uploads are verified by magic bytes, not just file extension
- **Encrypted Secrets at Rest** — SMTP and AI provider credentials are encrypted (Fernet)
- **HTTP Security Headers** — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, CSP via Nginx
- **CORS Restriction** — production allows only the configured `ALLOWED_ORIGINS`; dev restricts to LAN

## Production Deployment

For deploying to a server (IDC, VPS, etc.) behind a reverse proxy:

```bash
# 1. Clone and configure
git clone https://github.com/your-org/Weave.git
cd Weave
cp .env.production.example .env.production
# Edit .env.production — set DOMAIN, JWT_SECRET_KEY, POSTGRES_PASSWORD, ALLOWED_ORIGINS, ports, etc.

# 2. Build and start (Nginx exposes a single port)
make prod-build

# 3. (One-time) Issue an SSL certificate once DNS points at the host
make ssl-init

# 4. Update (when a new version is available)
git pull && make prod-build
```

In production, only the Nginx container's port is exposed; the backend, frontend, and database stay on an internal network. Point your host's reverse proxy at it — see [`nginx/host-nginx.conf.example`](nginx/host-nginx.conf.example) for a reference config.

### Minimum Requirements

| Resource | Recommended |
|----------|-------------|
| CPU      | 2 cores     |
| RAM      | 2 GB        |
| Disk     | 10 GB       |
| Docker   | 24+         |

### Production Commands

```bash
make prod-build   # Build and start production services
make prod-down    # Stop production services
make prod-logs    # Tail production logs
make ssl-renew    # Renew the SSL certificate
```

## Tech Stack

| Layer        | Technology                                              |
|--------------|---------------------------------------------------------|
| Frontend     | Next.js 16, React 19, SCSS, TipTap, Typst, dnd-kit, React Flow |
| Backend      | Python 3.13, FastAPI, SQLAlchemy (async), Alembic       |
| Database     | PostgreSQL 17                                            |
| Auth         | JWT (httpOnly cookie) + bcrypt                          |
| Real-time    | WebSocket; collaborative editing via Yjs CRDT (pycrdt)  |
| AI           | Anthropic / OpenAI (streaming)                          |
| Notifications| Web Push (VAPID)                                        |
| Infra        | Docker Compose, Nginx                                   |
| AI access    | MCP server (stdio) — see [`mcp/`](mcp/)                 |

## Contributing

Contributions are welcome! Whether it's bug reports, feature requests, or pull requests — all input is appreciated.

1. Fork the repository
2. Create your branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes
4. Push and open a Pull Request

## License

[MIT](LICENSE) © Weave Contributors
