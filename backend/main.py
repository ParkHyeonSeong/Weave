import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from library import validator
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
from routers import wiki_page as wiki_page_router

# -- Logging ---------------------------------------------------------------
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("weave")

# -- App -------------------------------------------------------------------
app = FastAPI(
    title="Weave API",
    description="In-house project management platform",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

DEBUG = os.getenv("DEBUG", "false").lower() == "true"
FRONTEND_PORT = os.getenv("FRONTEND_PORT", "3000")
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS")

if ALLOWED_ORIGINS:
    origins = ALLOWED_ORIGINS.split(",")
elif DEBUG:
    # 개발 모드: 모든 origin 허용 (LAN IP 접근 등)
    origins = ["*"]
else:
    origins = [
        f"http://localhost:{FRONTEND_PORT}",
        f"http://127.0.0.1:{FRONTEND_PORT}",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=not DEBUG,  # *와 credentials 동시 사용 불가
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
app.include_router(auth_router.router, prefix="/auth", tags=["auth"])
app.include_router(setup_router.router, prefix="/setup", tags=["setup"])
app.include_router(branch_router.router, prefix="/branches", tags=["branches"])
app.include_router(chat_router.router, prefix="/chat", tags=["chat"])
app.include_router(ws_chat_router.router, tags=["websocket"])
app.include_router(admin_router.router, prefix="/admin", tags=["admin"])
app.include_router(sprint_router.router, prefix="/branches/{branch_id}/sprints", tags=["sprints"])
app.include_router(label_router.router, prefix="/branches/{branch_id}/labels", tags=["labels"])
app.include_router(epic_router.router, prefix="/branches/{branch_id}/epics", tags=["epics"])
app.include_router(task_router.router, prefix="/branches/{branch_id}/tasks", tags=["tasks"])
app.include_router(task_type_config_router.router, prefix="/branches/{branch_id}/task-types", tags=["task-types"])
app.include_router(profile_router.router, prefix="/profile", tags=["profile"])
app.include_router(canvas_router.router, prefix="/wiki/canvases", tags=["wiki-canvases"])
app.include_router(wiki_page_router.router, prefix="/wiki/canvases/{canvas_id}/pages", tags=["wiki-pages"])

# -- Static files (업로드 파일 서빙) -----------------------------------------
uploads_dir = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(os.path.join(uploads_dir, 'avatars'), exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")


# -- Health ----------------------------------------------------------------
@app.get("/", summary="Health Check")
def health_check():
    return {"status": "ok", "service": "weave-api"}


@app.get("/api/health", summary="API Health Check")
def api_health():
    return {"status": "ok"}


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
