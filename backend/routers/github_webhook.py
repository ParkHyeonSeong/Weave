"""GitHub webhook 수신 라우터 — 비로그인 표면, HMAC가 유일 게이트.

raw body로 X-Hub-Signature-256(HMAC-SHA256)을 검증한 뒤, 멱등 staging INSERT만
하고 즉시 202를 반환한다(GitHub 10초 충족). 실제 처리는 BackgroundTask가 별도
transactional_session에서 claim 드레인하고, 실패/죽은락은 lifespan 루프가 재시도한다.
"""
import json
import logging

from fastapi import APIRouter, Request, BackgroundTasks
from fastapi.responses import JSONResponse

import config
from core.errors import error_response, ErrorCode
from core.model import github_webhook_event as event_model
from core.controller import github as github_controller
from library import github_app
import db_engine as db

logger = logging.getLogger("weave")
router = APIRouter()


@router.post("/webhook", summary="GitHub webhook 수신(HMAC 검증)")
async def receive_webhook(request: Request, background_tasks: BackgroundTasks):
    # 1) raw body로 서명 검증 (JSON 파싱 전 바이트, 타이밍 안전 비교는 라이브러리 내부)
    raw = await request.body()
    signature = request.headers.get("X-Hub-Signature-256", "")
    if not github_app.verify_signature(config.GITHUB_WEBHOOK_SECRET, raw, signature):
        return JSONResponse(status_code=401,
                            content=error_response(ErrorCode.NEED_LOGIN))

    event_type = request.headers.get("X-GitHub-Event", "")
    delivery_id = request.headers.get("X-GitHub-Delivery", "")
    if not delivery_id or not event_type:
        # 헤더 누락은 조용히 202(GitHub 재시도 유발 안 함). 처리 안 함.
        return JSONResponse(status_code=202, content={"status": True, "skipped": True})

    try:
        payload = json.loads(raw.decode() or "{}")
    except (ValueError, UnicodeDecodeError):
        return JSONResponse(status_code=202, content={"status": True, "skipped": True})

    # 2) 멱등 staging — delivery_id 충돌(재전송)은 insert가 None 반환 -> 202 no-op
    async with db.transactional_session() as session:
        row = await event_model.insert(delivery_id, event_type, payload, session)

    if row is None:
        return JSONResponse(status_code=202, content={"status": True, "duplicate": True})

    # 3) 응답 직후 처리 시작(드레인). lifespan 루프가 실패/죽은락 재시도.
    background_tasks.add_task(github_controller.drain_webhook_events)
    return JSONResponse(status_code=202, content={"status": True})
