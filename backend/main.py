import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from slowapi.errors import RateLimitExceeded

from config import MAX_REQUEST_BODY_BYTES
from library import validator
from library.origins import cors_allow_origins, ALLOWED_ORIGIN_REGEX
from library.rate_limiter import limiter
from library.ws_collab_manager import collab_manager, scrum_week_collab_manager, scrum_retro_collab_manager
from routers import auth as auth_router
from routers import setup as setup_router
from routers import branch as branch_router
from routers import chat as chat_router
from routers import uploads as uploads_router
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
from routers import scrum_home as scrum_home_router
from routers import scrum_board as scrum_board_router
from routers import scrum_week as scrum_week_router
from routers import scrum_retro as scrum_retro_router
from routers import ws_scrum as ws_scrum_router
from routers import ws_scrum_retro as ws_scrum_retro_router
from routers import pat as pat_router
from core.controller import pat as pat_controller
from core.controller import jira_migrate as jira_migrate_controller
import db_engine as db

# Jira 임시 CSV 정리 주기(초, SEC-24)
JIRA_TEMP_CLEANUP_INTERVAL = int(os.getenv("JIRA_TEMP_CLEANUP_INTERVAL", "3600"))

# -- Logging ---------------------------------------------------------------
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("weave")

# -- Lifespan ---------------------------------------------------------------
async def _periodic_jira_temp_cleanup():
    """주기적으로 TTL 초과 Jira 임시 CSV를 정리한다(SEC-24)."""
    while True:
        try:
            await asyncio.sleep(JIRA_TEMP_CLEANUP_INTERVAL)
            removed = await asyncio.to_thread(jira_migrate_controller.cleanup_temp_files)
            if removed:
                logger.info("Cleaned %d expired Jira temp file(s)", removed)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.warning("Jira temp cleanup tick failed", exc_info=False)


@asynccontextmanager
async def lifespan(app):
    # Startup: 시작 시 1회 고아 임시파일 청소 + 주기 청소 태스크 기동(SEC-24).
    # 동기 I/O라 to_thread로 위임해 스타트업 이벤트루프 블로킹을 피한다.
    await asyncio.to_thread(jira_migrate_controller.cleanup_temp_files)
    cleanup_task = asyncio.create_task(_periodic_jira_temp_cleanup())
    yield
    # Graceful shutdown: 청소 태스크 정리(취소 완료 대기) + 활성 collaboration room 영속화
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    logger.info("Persisting active collaboration rooms...")
    await collab_manager.persist_all()
    await scrum_week_collab_manager.persist_all()
    await scrum_retro_collab_manager.persist_all()


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

_CORS_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
_CORS_HEADERS = ["Content-Type", "Authorization", "X-Requested-With"]

# origin 허용 정책은 library.origins 단일 소스(WebSocket Origin 검증과 공유, SEC-30/38/39).
# DEBUG+명시목록 없음 → 루프백 임의 포트 정규식, 그 외 → 명시목록/기본 localhost.
if ALLOWED_ORIGIN_REGEX:
    _cors_origin = {"allow_origin_regex": ALLOWED_ORIGIN_REGEX}
else:
    _cors_origin = {"allow_origins": cors_allow_origins()}

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_methods=_CORS_METHODS,
    allow_headers=_CORS_HEADERS,
    **_cors_origin,
)


# -- Middleware ------------------------------------------------------------
# 아래에 정의된 미들웨어일수록 바깥(먼저 실행)이다. body-size 검사를 auth보다 바깥에 둬
# 대형 본문을 인증/본문 파싱 전에 거른다.
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    payload = validator.validate_login(request)  # cookie JWT (sync, no DB)
    if not payload.get('user_id'):
        auth = request.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            token = auth[7:].strip()
            if token:  # skip the DB lookup for an empty "Bearer " header
                async with db.transactional_session() as session:
                    pat_payload = await pat_controller.authenticate_token(token, session)
                if pat_payload:
                    payload = pat_payload
    request.state.payload = payload
    response = await call_next(request)
    return response


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    """전역 요청 본문 크기 상한(SEC-32) — Content-Length 기반 사전 거절.

    일반 HTTP 클라이언트(axios/fetch, 멀티파트 업로드)는 항상 Content-Length를 보내므로
    본문 파싱 전에 대형 요청을 거른다. Content-Length가 없는 chunked 전송은 여기서 막지
    못하며, 그 경계는 reverse proxy가 담당한다(nginx client_max_body_size 20M는 chunked에도
    적용). 프로덕션에서 backend는 internal-only(expose)라 nginx를 거치지 않는 직접 접근
    자체가 불가능하므로, 이 미들웨어는 그 위에 더해지는 앱 레벨 방어선이다."""
    if MAX_REQUEST_BODY_BYTES > 0:
        content_length = request.headers.get('content-length')
        if content_length:
            try:
                if int(content_length) > MAX_REQUEST_BODY_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={"status": False, "message": "REQUEST_TOO_LARGE"},
                    )
            except ValueError:
                pass
    return await call_next(request)


# -- Routers ---------------------------------------------------------------
app.include_router(auth_router.router, prefix="/api/auth", tags=["auth"])
app.include_router(setup_router.router, prefix="/api/setup", tags=["setup"])
app.include_router(branch_router.router, prefix="/api/branches", tags=["branches"])
app.include_router(chat_router.router, prefix="/api/chat", tags=["chat"])
app.include_router(ws_chat_router.router, prefix="/api", tags=["websocket"])
app.include_router(ws_canvas_router.router, prefix="/api", tags=["websocket"])
app.include_router(ws_scrum_router.router, prefix="/api", tags=["websocket"])
app.include_router(ws_scrum_retro_router.router, prefix="/api", tags=["websocket"])
app.include_router(admin_router.router, prefix="/api/admin", tags=["admin"])
app.include_router(sprint_router.router, prefix="/api/branches/{branch_id}/sprints", tags=["sprints"])
app.include_router(label_router.router, prefix="/api/branches/{branch_id}/labels", tags=["labels"])
app.include_router(epic_router.router, prefix="/api/branches/{branch_id}/epics", tags=["epics"])
app.include_router(task_router.router, prefix="/api/branches/{branch_id}/tasks", tags=["tasks"])
app.include_router(task_type_config_router.router, prefix="/api/branches/{branch_id}/task-types", tags=["task-types"])
app.include_router(profile_router.router, prefix="/api/profile", tags=["profile"])
app.include_router(pat_router.router, prefix="/api/profile/tokens", tags=["tokens"])
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
app.include_router(scrum_home_router.router, prefix="/api/scrum", tags=["scrum"])
app.include_router(scrum_board_router.router, prefix="/api/scrum", tags=["scrum"])
app.include_router(scrum_week_router.router, prefix="/api/scrum", tags=["scrum"])
app.include_router(scrum_retro_router.router, prefix="/api/scrum", tags=["scrum"])

# -- 업로드 파일 서빙 (인증 + 멤버십 검증, SEC-19) ---------------------------
uploads_dir = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(os.path.join(uploads_dir, 'avatars'), exist_ok=True)
os.makedirs(os.path.join(uploads_dir, 'chat'), exist_ok=True)
os.makedirs(os.path.join(uploads_dir, 'task'), exist_ok=True)
app.include_router(uploads_router.router, prefix="/api/uploads", tags=["uploads"])


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
