# Weave

In-house project management platform.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Docker Engine 24+ with Compose V2)

## Quick Start

```bash
# 1. Create environment file
cp .env.example .env

# 2. Build and start all services
make up-build

# 3. View logs
make logs
```

Services will be available at (ports configurable in `.env`):

| Service    | URL                              |
|------------|----------------------------------|
| Frontend   | http://localhost:{FRONTEND_PORT} |
| Backend    | http://localhost:{BACKEND_PORT}  |
| API Docs   | http://localhost:{BACKEND_PORT}/docs |
| PostgreSQL | localhost:{DB_PORT}              |

## Common Commands

```bash
make help           # Show all available commands
make up             # Start all services
make down           # Stop all services
make logs           # Tail all logs
make logs-backend   # Tail backend logs only
make db-shell       # Open PostgreSQL shell
make clean          # Stop and remove all data
```

## Project Structure

```
Weave/
├── backend/           # FastAPI backend
│   ├── main.py        # Application entry point
│   ├── config.py      # Configuration
│   ├── Dockerfile
│   └── pyproject.toml
├── frontend/          # Next.js frontend
│   ├── pages/
│   ├── styles/
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
├── Makefile
├── .env.example
└── README.md
```

## Tech Stack

- **Frontend:** Next.js 16, React 19
- **Backend:** Python 3.13, FastAPI, SQLAlchemy
- **Database:** PostgreSQL 17
- **Containerization:** Docker Compose
