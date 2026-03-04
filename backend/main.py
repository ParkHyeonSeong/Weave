import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from library import validator
from routers import auth as auth_router
from routers import setup as setup_router

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

FRONTEND_PORT = os.getenv("FRONTEND_PORT", "3000")
_default_origins = [
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
]
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS")
origins = ALLOWED_ORIGINS.split(",") if ALLOWED_ORIGINS else _default_origins

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
app.include_router(auth_router.router, prefix="/auth", tags=["auth"])
app.include_router(setup_router.router, prefix="/setup", tags=["setup"])


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
