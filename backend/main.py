import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from library import validator
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
from routers import task_issue as task_issue_router
from routers import my_tasks as my_tasks_router
from routers import ws_canvas as ws_canvas_router
from routers import ref_status as ref_status_router
# from routers import ai as ai_router
from routers import recent_view as recent_view_router
from routers import workflow_status as workflow_status_router
from routers import custom_field as custom_field_router
from routers import notification as notification_router
from routers import task_dependency as task_dependency_router
from routers import task_page_link as task_page_link_router
from routers import url_meta as url_meta_router
from routers import star as star_router
from routers import push as push_router

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
app = FastAPI(
    title="Weave API",
    description="In-house project management platform",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

DEBUG = os.getenv("DEBUG", "false").lower() == "true"
FRONTEND_PORT = os.getenv("FRONTEND_PORT", "3000")
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS")

if ALLOWED_ORIGINS:
    origins = ALLOWED_ORIGINS.split(",")
else:
    origins = [
        f"http://localhost:{FRONTEND_PORT}",
        f"http://127.0.0.1:{FRONTEND_PORT}",
    ]

if DEBUG and not ALLOWED_ORIGINS:
    # 개발 모드: 모든 origin 허용 (LAN IP 접근 등) + credentials 지원
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"https?://.*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
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
app.include_router(task_issue_router.router, prefix="/api/branches/{branch_id}/tasks/{task_id}/issues", tags=["task-issues"])
app.include_router(my_tasks_router.router, prefix="/api/my-tasks", tags=["my-tasks"])
app.include_router(ref_status_router.router, prefix="/api/ref-status", tags=["ref-status"])
# app.include_router(ai_router.router, prefix="/api/ai", tags=["ai"])
app.include_router(recent_view_router.router, prefix="/api/recent-views", tags=["recent-views"])
app.include_router(workflow_status_router.router, prefix="/api/branches/{branch_id}/workflow-statuses", tags=["workflow-statuses"])
app.include_router(custom_field_router.router, prefix="/api/branches/{branch_id}/task-types/{type_id}/custom-fields", tags=["custom-fields"])
app.include_router(notification_router.router, prefix="/api/notifications", tags=["notifications"])
app.include_router(task_dependency_router.router, prefix="/api/branches/{branch_id}/dependencies", tags=["dependencies"])
app.include_router(task_page_link_router.router, prefix="/api/branches/{branch_id}/tasks/{task_id}/pages", tags=["task-pages"])
app.include_router(url_meta_router.router, prefix="/api/url-meta", tags=["url-meta"])
app.include_router(star_router.router, prefix="/api/stars", tags=["stars"])
app.include_router(push_router.router, prefix="/api/push", tags=["push"])

# -- Static files (업로드 파일 서빙) -----------------------------------------
uploads_dir = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(os.path.join(uploads_dir, 'avatars'), exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=uploads_dir), name="uploads")


# -- Health ----------------------------------------------------------------
@app.get("/api/health", summary="API Health Check")
def api_health():
    return {"status": "ok", "service": "weave-api"}


# -- Exception handlers ----------------------------------------------------
@app.exception_handler(validator.UnAuthorizedException)
async def unauthorized_handler(request: Request, exc: validator.UnAuthorizedException):
    return JSONResponse(
        status_code=200,
        content={"status": exc.status, "message": exc.message},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception at %s: %s", request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"status": False, "message": "INTERNAL_SERVER_ERROR"},
    )
