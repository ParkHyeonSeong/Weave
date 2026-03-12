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
- **Labels & Priorities** — categorize and prioritize with visual tags
- **Issue Threads** — discuss specific tasks with threaded comments
- **My Tasks** — personal dashboard with filters across all projects

### 📝 Canvas (Documentation)
A rich knowledge base built on TipTap, replacing Confluence.

- **Rich Text Editor** — headings, tables, code blocks with syntax highlighting, math (KaTeX), callouts
- **Page Hierarchy** — nested documents with drag-and-drop reordering
- **Image Support** — paste, drag-and-drop, or upload images directly
- **Task References** — link tasks inline with live preview popups

### 💬 Messenger (Real-time Chat)
Built-in team communication via WebSocket.

- **Direct & Group Messages** — 1:1 or group conversations
- **Task References in Chat** — search and link tasks with `/` commands
- **Read Receipts** — see who's read your messages
- **Persistent History** — full message history with pagination

### 🔧 Administration
- **Setup Wizard** — guided initial configuration (workspace name, registration policy, admin account)
- **User Management** — approve/reject registrations, assign roles
- **Registration Policies** — public or invite-only signup

### ⚡ Productivity
- **PWA (Progressive Web App)** — install Weave as a native app on desktop and mobile
- **Background Push Notifications** — receive alerts even when the browser is closed
- **Command Palette** — `⌘K` to quickly navigate or create resources
- **Resizable Panels** — sidebar and messenger widths persist across sessions
- **Browse & Discover** — find and join public projects and canvases

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
| API Docs   | http://localhost:8000/docs    |
| PostgreSQL | localhost:5432               |

> Ports are configurable via `.env`.

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

| Resource | Recommended |ㄴ
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
| Frontend     | Next.js 16, React 19, SCSS, TipTap, dnd-kit        |
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
