# Weave

In-house project management platform to replace Jira and Confluence.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Docker Engine 24+ with Compose V2)

## Quick Start

```bash
# 1. Create environment file
cp .env.example .env

# 2. Build and start all services
make up-build

# 3. Run database migration
docker compose exec backend alembic upgrade head

# 4. View logs
make logs
```

Services will be available at (ports configurable in `.env`):

| Service    | URL                                   |
|------------|---------------------------------------|
| Frontend   | http://localhost:{FRONTEND_PORT}       |
| Backend    | http://localhost:{BACKEND_PORT}        |
| API Docs   | http://localhost:{BACKEND_PORT}/docs   |
| PostgreSQL | localhost:{DB_PORT}                    |

## Common Commands

```bash
make help           # Show all available commands
make up             # Start all services
make up-build       # Build and start all services
make down           # Stop all services
make restart        # Restart all services
make logs           # Tail all logs
make logs-backend   # Tail backend logs only
make logs-frontend  # Tail frontend logs only
make db-shell       # Open PostgreSQL shell
make clean          # Stop and remove all data (volumes)
make clean-all      # Stop and remove all data + images
```

## Project Structure

```
Weave/
├── backend/                  # FastAPI backend (Python 3.13)
│   ├── main.py               # App entry point, CORS, JWT middleware
│   ├── config.py             # Environment config (DB, JWT)
│   ├── db_engine.py          # Async SQLAlchemy engine + session
│   ├── routers/
│   │   ├── auth.py           # /auth/login, /auth/register, /auth/health
│   │   └── schema/
│   │       └── auth.py       # Pydantic request schemas
│   ├── core/
│   │   ├── controller/
│   │   │   └── auth.py       # Auth business logic (bcrypt, JWT)
│   │   └── model/
│   │       └── user.py       # User CRUD (raw SQL via text())
│   ├── library/
│   │   └── validator.py      # JWT validation, require_login
│   ├── migrations/
│   │   ├── env.py            # Alembic async environment
│   │   └── versions/
│   │       └── 001_create_user_table.py
│   ├── alembic.ini
│   ├── Dockerfile
│   └── pyproject.toml
├── frontend/                 # Next.js 16 frontend (React 19)
│   ├── pages/
│   │   ├── _app.js           # Global layout, route guard, SCSS imports
│   │   ├── index.js
│   │   └── auth/
│   │       └── login.js      # Login/Register page
│   ├── components/
│   │   ├── Auth/
│   │   │   └── Login.js      # Login/Register form component
│   │   └── modal/
│   │       └── Alert.js      # Alert modal
│   ├── library/
│   │   └── _axios/
│   │       └── index.js      # Axios instance + Bearer interceptor
│   ├── styles/
│   │   ├── _variables.scss   # Design tokens (Linear light mode)
│   │   ├── globals.scss      # Global reset
│   │   └── components/
│   │       ├── auth/
│   │       │   └── login.scss
│   │       └── modal/
│   │           └── alert.scss
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
├── Makefile
├── .env.example
└── README.md
```

## Tech Stack

- **Frontend:** Next.js 16 (Turbopack), React 19, SCSS, Axios
- **Backend:** Python 3.13, FastAPI, SQLAlchemy (async), Alembic
- **Database:** PostgreSQL 17
- **Auth:** JWT (PyJWT) + bcrypt
- **Containerization:** Docker Compose

## Architecture

### Backend 3-Layer Pattern

```
Router (routers/) → Controller (core/controller/) → Model (core/model/)
```

- **Router**: HTTP endpoint, request validation (Pydantic schema)
- **Controller**: Business logic, JWT token generation
- **Model**: Database queries via raw SQL + `text()`

### Auth Flow

```
POST /auth/register → Email duplicate check → bcrypt hash → INSERT → JWT
POST /auth/login    → Email lookup → bcrypt verify → JWT
```

JWT payload: `{ user_id, email, username, exp }`
Token stored in `sessionStorage` on frontend.

### Frontend Route Guard

`_app.js` checks `sessionStorage` for `x_token`:
- No token + private page → redirect to `/auth/login`
- Has token + auth page → redirect to `/`
- Axios interceptor detects `NEED_LOGIN` → fires `auth:expired` event → auto logout

## Database Migration

```bash
# Run migrations
docker compose exec backend alembic upgrade head

# Create new migration
docker compose exec backend alembic revision --autogenerate -m "description"

# Check current version
docker compose exec backend alembic current
```
