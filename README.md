<p align="center">
  <img src="frontend/public/icons/weave_square.svg" alt="Weave" width="80" />
</p>

<h1 align="center">Weave</h1>

<p align="center">
  Open-source project management platform — a self-hostable alternative to Jira + Confluence.
</p>

<p align="center">
  <a href="#features">Features</a> · <a href="#quick-start">Quick Start</a> · <a href="#tech-stack">Tech Stack</a> · <a href="#contributing">Contributing</a>
</p>

---

## Why Weave?

Most teams use Jira for tasks and Confluence for docs — two separate tools, two separate contexts. Weave combines project management, documentation, and team chat into a single, self-hosted platform that you fully own.

- **No per-seat pricing.** Host it yourself, invite your whole team.
- **All-in-one.** Tasks, docs, and chat in one place — no more context switching.
- **Simple to deploy.** One `make up-build` and you're running.

## Features

### 📋 Task Management
Organize work with a flexible task system inspired by Linear.

- **Kanban Board** — drag-and-drop cards across status columns
- **Sprints** — plan iterations, activate, and track completion
- **Epics & Timeline** — visualize long-term plans across weeks, months, or quarters
- **Custom Task Types** — define your own task types per project
- **Custom Fields** — add custom fields per task type for flexible tracking
- **Workflow Statuses** — define custom status flows per project
- **Labels & Priorities** — categorize and prioritize with visual tags
- **Task Dependencies** — set blocking/blocked-by relationships between tasks
- **Task Filtering** — filter tasks by status, assignee, label, priority, and more
- **Issue Threads** — discuss specific tasks with threaded comments
- **My Tasks** — personal dashboard with filters across all projects

### 📝 Canvas (Documentation)
A rich knowledge base built on TipTap, replacing Confluence.

- **Rich Text Editor** — headings, tables, code blocks with syntax highlighting, math (KaTeX), callouts
- **Markdown Paste** — paste markdown content and it auto-converts to rich text
- **Inline Annotations** — leave comments on specific parts of a document
- **Typst Editor** — write and render Typst documents alongside rich text pages
- **Page Hierarchy** — nested documents with drag-and-drop reordering
- **Image Support** — paste, drag-and-drop, or upload images directly
- **Task References** — link tasks inline with live preview popups

### 💬 Messenger (Real-time Chat)
Built-in team communication via WebSocket.

- **Direct & Group Messages** — 1:1 or group conversations
- **File Attachments** — share files and images in conversations
- **Task References in Chat** — search and link tasks with `/` commands
- **Picture-in-Picture** — pop out the messenger into a floating window
- **Read Receipts** — see who's read your messages
- **Persistent History** — full message history with pagination

### 📅 Schedule
Project-level calendar for planning and tracking events.

- **Calendar View** — visualize events on a monthly/weekly calendar
- **Event-Task Linking** — connect schedule events to tasks for cross-referencing

### 🔧 Administration
- **Setup Wizard** — guided initial configuration (workspace name, registration policy, admin account)
- **User Management** — approve/reject registrations, assign roles
- **Forced Password Change** — admin can require users to reset their password on next login
- **Registration Policies** — public or invite-only signup
- **AI Integration** — configure AI providers (API key, model) from admin settings

### ⚡ Productivity
- **PWA (Progressive Web App)** — install Weave as a native app on desktop and mobile
- **Mobile Responsive** — fully responsive UI that adapts to phones and tablets
- **Background Push Notifications** — receive alerts even when the browser is closed
- **In-app Notifications** — real-time notification feed with read/unread tracking
- **Online Presence** — see who's online with real-time status indicators
- **Command Palette** — `⌘K` to quickly navigate or create resources
- **Starring & Recent Views** — bookmark items and quickly access recent activity
- **Resizable Panels** — sidebar and messenger widths persist across sessions
- **Browse & Discover** — find and join public projects and canvases
- **Jira Migration** — import projects from Jira via CSV export

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

| Service    | Default URL                  |
|------------|------------------------------|
| Frontend   | http://localhost:3000         |
| Backend    | http://localhost:8000         |
| API Docs   | http://localhost:8000/docs (dev only) |
| PostgreSQL | localhost:5432               |

> Ports are configurable via `.env`. API Docs (Swagger UI) is only available when `DEBUG=true`.

## Security

Weave includes the following built-in security measures:

- **SSRF Protection** — URL metadata fetching validates DNS-resolved IPs, blocking internal networks and cloud metadata endpoints
- **Rate Limiting** — login, registration, and API endpoints are rate-limited per IP
- **XSS Prevention** — all user-generated HTML is sanitized with DOMPurify before rendering
- **File Upload Validation** — image uploads are verified by magic bytes, not just file extension
- **HTTP Security Headers** — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS via Nginx
- **CORS Restriction** — production mode only allows the configured `ALLOWED_ORIGINS`; dev mode restricts to LAN

## Production Deployment

For deploying to a server (IDC, VPS, etc.) with an existing Nginx reverse proxy:

```bash
# 1. Clone and configure
git clone https://github.com/your-org/Weave.git
cd Weave
cp .env.production.example .env.production
# Edit .env.production — set DOMAIN, POSTGRES_PASSWORD, ports, etc.

# 2. Build and start
make prod-build

# 3. Update (when new version is available)
git pull && make prod-build
```

Configure your host Nginx to proxy to the exposed ports — see `nginx/host-nginx.conf.example` for a reference config.

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
make prod-ps      # Show production service status
```

## Tech Stack

| Layer        | Technology                                         |
|--------------|----------------------------------------------------|
| Frontend     | Next.js 16, React 19, SCSS, TipTap, Typst, dnd-kit |
| Backend      | Python 3.13, FastAPI, SQLAlchemy (async), Alembic   |
| Database     | PostgreSQL 17                                       |
| Auth         | JWT (httpOnly cookie) + bcrypt                      |
| Real-time    | WebSocket                                           |
| Infra        | Docker Compose                                      |

## Contributing

Contributions are welcome! Whether it's bug reports, feature requests, or pull requests — all input is appreciated.

1. Fork the repository
2. Create your branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes
4. Push and open a Pull Request

## License

[MIT](LICENSE) © Weave Contributors
