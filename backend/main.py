import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from slowapi.errors import RateLimitExceeded

from library import validator
from library.rate_limiter import limiter
from library.ws_collab_manager import collab_manager
from routers import auth as auth_router
from routers import setup as setup_router
from routers import branch as branch_router
from routers import chat as chat_router
from routers import ws_chat as ws_chat_router
from routers import admin as admin_router
from routers import sprint as sprint_router
from routers import label as label_router
from routers import epic as epic_router
from routers import task as task_router
from routers import profile as profile_router
from routers import task_type_config as task_type_config_router
from routers import canvas as canvas_router
from routers import canvas_page as canvas_page_router
from routers import canvas_annotation as canvas_annotation_router
from routers import task_issue as task_issue_router
from routers import task_comment as task_comment_router
from routers import my_tasks as my_tasks_router
from routers import ws_canvas as ws_canvas_router
from routers import ref_status as ref_status_router
from routers import ai as ai_router
from routers import recent_view as recent_view_router
from routers import workflow_status as workflow_status_router
from routers import custom_field as custom_field_router
from routers import notification as notification_router
from routers import activity_log as activity_log_router
from routers import task_dependency as task_dependency_router
from routers import task_page_link as task_page_link_router
from routers import url_meta as url_meta_router
from routers import star as star_router
from routers import push as push_router
from routers import schedule_event as schedule_event_router
from routers import schedule_event_task as event_task_router
from routers import jira_migrate as jira_migrate_router
from routers import track as track_router

# -- Logging ---------------------------------------------------------------
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("weave")

# -- Lifespan ---------------------------------------------------------------
@asynccontextmanager
async def lifespan(app):
    yield
    # Graceful shutdown: 활성 collaboration room 영속화
    logger.info("Persisting active collaboration rooms...")
    await collab_manager.persist_all()


# -- App -------------------------------------------------------------------
DEBUG = os.getenv("DEBUG", "false").lower() == "true"

app = FastAPI(
    title="Weave API",
    description="In-house project management platform",
    version="0.1.0",
    docs_url="/api/docs" if DEBUG else None,
    redoc_url="/api/redoc" if DEBUG else None,
    openapi_url="/api/openapi.json" if DEBUG else None,
    lifespan=lifespan,
)
# -- Rate Limiting ---------------------------------------------------------
app.state.limiter = limiter

FRONTEND_PORT = os.getenv("FRONTEND_PORT", "3000")
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS")

if ALLOWED_ORIGINS:
    origins = ALLOWED_ORIGINS.split(",")
else:
    origins = [
        f"http://localhost:{FRONTEND_PORT}",
        f"http://127.0.0.1:{FRONTEND_PORT}",
    ]

_CORS_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
_CORS_HEADERS = ["Content-Type", "Authorization", "X-Requested-With"]

if DEBUG and not ALLOWED_ORIGINS:
    # 개발 모드: LAN 범위 origin 허용 + credentials 지원
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?",
        allow_credentials=True,
        allow_methods=_CORS_METHODS,
        allow_headers=_CORS_HEADERS,
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=_CORS_METHODS,
        allow_headers=_CORS_HEADERS,
    )


# -- Middleware ------------------------------------------------------------
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    request.state.payload = validator.validate_login(request)
    response = await call_next(request)
    return response


# -- Routers ---------------------------------------------------------------
app.include_router(auth_router.router, prefix="/api/auth", tags=["auth"])
app.include_router(setup_router.router, prefix="/api/setup", tags=["setup"])
app.include_router(branch_router.router, prefix="/api/branches", tags=["branches"])
app.include_router(chat_router.router, prefix="/api/chat", tags=["chat"])
app.include_router(ws_chat_router.router, prefix="/api", tags=["websocket"])
app.include_router(ws_canvas_router.router, prefix="/api", tags=["websocket"])
app.include_router(admin_router.router, prefix="/api/admin", tags=["admin"])
app.include_router(sprint_router.router, prefix="/api/branches/{branch_id}/sprints", tags=["sprints"])
app.include_router(label_router.router, prefix="/api/branches/{branch_id}/labels", tags=["labels"])
app.include_router(epic_router.router, prefix="/api/branches/{branch_id}/epics", tags=["epics"])
app.include_router(task_router.router, prefix="/api/branches/{branch_id}/tasks", tags=["tasks"])
app.include_router(task_type_config_router.router, prefix="/api/branches/{branch_id}/task-types", tags=["task-types"])
app.include_router(profile_router.router, prefix="/api/profile", tags=["profile"])
app.include_router(canvas_router.router, prefix="/api/canvases", tags=["canvases"])
app.include_router(canvas_page_router.router, prefix="/api/canvases/{canvas_id}/pages", tags=["canvas-pages"])
app.include_router(canvas_annotation_router.router, prefix="/api/canvases/{canvas_id}/pages/{page_id}/annotations", tags=["canvas-annotations"])
app.include_router(task_issue_router.router, prefix="/api/branches/{branch_id}/tasks/{task_id}/issues", tags=["task-issues"])
app.include_router(
    task_comment_router.router,
    prefix="/api/branches/{branch_id}/tasks/{task_id}/comments",
    tags=["task-comments"],
)
app.include_router(my_tasks_router.router, prefix="/api/my-tasks", tags=["my-tasks"])
app.include_router(ref_status_router.router, prefix="/api/ref-status", tags=["ref-status"])
app.include_router(ai_router.router, prefix="/api/ai", tags=["ai"])
app.include_router(recent_view_router.router, prefix="/api/recent-views", tags=["recent-views"])
app.include_router(workflow_status_router.router, prefix="/api/branches/{branch_id}/workflow-statuses", tags=["workflow-statuses"])
app.include_router(custom_field_router.router, prefix="/api/branches/{branch_id}/task-types/{type_id}/custom-fields", tags=["custom-fields"])
app.include_router(notification_router.router, prefix="/api/notifications", tags=["notifications"])
app.include_router(activity_log_router.router, prefix="/api", tags=["activity-log"])
app.include_router(task_dependency_router.router, prefix="/api/branches/{branch_id}/dependencies", tags=["dependencies"])
app.include_router(task_page_link_router.router, prefix="/api/branches/{branch_id}/tasks/{task_id}/pages", tags=["task-pages"])
app.include_router(url_meta_router.router, prefix="/api/url-meta", tags=["url-meta"])
app.include_router(star_router.router, prefix="/api/stars", tags=["stars"])
app.include_router(push_router.router, prefix="/api/push", tags=["push"])
app.include_router(schedule_event_router.router, prefix="/api/branches/{branch_id}/schedule-events", tags=["schedule-events"])
app.include_router(event_task_router.router, prefix="/api/branches/{branch_id}/schedule-events/{event_id}/tasks", tags=["schedule-event-tasks"])
app.include_router(jira_migrate_router.router, prefix="/api/branches/{branch_id}/jira-migrate", tags=["jira-migrate"])
app.include_router(track_router.router, prefix="/api/tracks", tags=["tracks"])

# -- Static files (업로드 파일 서빙) -----------------------------------------
uploads_dir = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(os.path.join(uploads_dir, 'avatars'), exist_ok=True)
os.makedirs(os.path.join(uploads_dir, 'chat'), exist_ok=True)
os.makedirs(os.path.join(uploads_dir, 'task'), exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=uploads_dir), name="uploads")


# -- Health ----------------------------------------------------------------
@app.get("/api/health", summary="API Health Check")
def api_health():
    return {"status": "ok", "service": "weave-api"}


# -- Exception handlers ----------------------------------------------------
@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"status": False, "message": "RATE_LIMIT_EXCEEDED"},
    )


@app.exception_handler(validator.UnAuthorizedException)
async def unauthorized_handler(request: Request, exc: validator.UnAuthorizedException):
    return JSONResponse(
        status_code=401,
        content={"status": exc.status, "message": exc.message},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception at %s: %s", request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"status": False, "message": "INTERNAL_SERVER_ERROR"},
    )
