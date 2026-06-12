import json
import logging

import httpx
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from core.model import ai as ai_model

logger = logging.getLogger("weave.ai")


async def get_config(request: Request, db: AsyncSession):
    """AI 설정 조회 (API 키 마스킹)"""
    config = await ai_model.get_config(db)
    if not config:
        return {'status': True, 'config': None}
    masked = {**config}
    key = masked.get('api_key', '')
    masked['api_key'] = f"****{key[-4:]}" if len(key) >= 4 else '****'
    return {'status': True, 'config': masked}


async def save_config(body, request: Request, db: AsyncSession):
    """AI 설정 저장"""
    user_id = request.state.payload.get('user_id')
    config = await ai_model.upsert_config(
        provider=body.provider,
        api_key=body.api_key,
        model=body.model,
        updated_by=user_id,
        db=db,
    )
    # 원본 키 기준 마스킹 (DB 반환값은 암호화된 값이므로 body.api_key 사용)
    masked = {**config}
    key = body.api_key
    masked['api_key'] = f"****{key[-4:]}" if len(key) >= 4 else '****'
    return {'status': True, 'config': masked}


async def list_conversations(request: Request, db: AsyncSession):
    """사용자의 AI 대화 목록"""
    user_id = request.state.payload.get('user_id')
    conversations = await ai_model.find_conversations_by_user(user_id, db)
    return {'status': True, 'conversations': conversations}


async def create_conversation(body, request: Request, db: AsyncSession):
    """새 AI 대화 생성"""
    user_id = request.state.payload.get('user_id')
    title = body.title or 'New Conversation'
    conversation = await ai_model.create_conversation(user_id, title, db)
    return {'status': True, 'conversation': conversation}


async def delete_conversation(conversation_id: int, request: Request, db: AsyncSession):
    """AI 대화 삭제"""
    user_id = request.state.payload.get('user_id')
    deleted = await ai_model.delete_conversation(conversation_id, user_id, db)
    if not deleted:
        return {'status': False, 'message': 'NOT_FOUND_OR_NOT_OWNER'}
    return {'status': True}


async def update_conversation_title(conversation_id: int, title: str,
                                     request: Request, db: AsyncSession):
    """대화 제목 변경"""
    user_id = request.state.payload.get('user_id')
    conversation = await ai_model.find_conversation_by_id(conversation_id, db)
    if not conversation or conversation['user_id'] != user_id:
        return {'status': False, 'message': 'NOT_FOUND_OR_NOT_OWNER'}
    await ai_model.update_conversation_title(conversation_id, title, db)
    return {'status': True}


async def get_messages(conversation_id: int, request: Request, db: AsyncSession):
    """대화의 메시지 목록 (소유자 확인)"""
    user_id = request.state.payload.get('user_id')
    conversation = await ai_model.find_conversation_by_id(conversation_id, db)
    if not conversation or conversation['user_id'] != user_id:
        return {'status': False, 'message': 'NOT_FOUND_OR_NOT_OWNER'}
    messages = await ai_model.find_messages_by_conversation(conversation_id, db)
    return {'status': True, 'messages': messages, 'conversation': conversation}


async def toggle_pin(message_id: int, request: Request, db: AsyncSession):
    """메시지 핀 토글 (소유자 확인)"""
    user_id = request.state.payload.get('user_id')
    msg = await ai_model.find_message_by_id(message_id, db)
    if not msg or msg['user_id'] != user_id:
        return {'status': False, 'message': 'NOT_FOUND_OR_NOT_OWNER'}
    result = await ai_model.toggle_pin(message_id, db)
    return {'status': True, 'is_pinned': result['is_pinned']}


async def _get_task_summary(user_id: int, db: AsyncSession) -> str:
    """사용자의 태스크 요약 (상태별 개수)"""
    from sqlalchemy import text
    result = await db.execute(text("""
        SELECT t.status, COUNT(*) AS cnt
        FROM task t
        INNER JOIN task_assignee ta ON t.task_id = ta.task_id
        WHERE ta.user_id = :user_id
        GROUP BY t.status
        ORDER BY t.status
    """), {'user_id': user_id})
    rows = result.fetchall()
    if not rows:
        return "No tasks assigned."
    parts = [f"{row[0]}: {row[1]}" for row in rows]
    return "User's tasks — " + ", ".join(parts)


def _build_system_prompt(task_summary: str) -> str:
    """시스템 프롬프트 생성"""
    return (
        "You are Weave AI, a helpful assistant for the Weave project management platform. "
        "You help users manage their tasks, sprints, epics, and projects. "
        "Be concise and actionable in your responses.\n\n"
        f"Current project context:\n{task_summary}"
    )


def _log_llm_api_error(provider: str, status_code: int, body: bytes) -> None:
    """LLM API 오류 로깅 — 응답 본문은 사용자 요청을 echo back할 수 있어 기본 로그엔
    상태 코드와 바이트 크기만 남기고, 전체 본문은 DEBUG에서만 남긴다(SEC-05)."""
    logger.error("%s API error: %s (%d bytes)", provider, status_code, len(body))
    # 이 가드는 DEBUG 비활성 시 body.decode() 비용을 피하기 위한 것 — 로그 억제용이 아니므로 제거 금지.
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug("%s API error body: %s", provider, body.decode(errors="replace"))


async def send_message(conversation_id: int, body, request: Request, db: AsyncSession):
    """메시지 전송 + LLM 스트리밍 응답"""
    user_id = request.state.payload.get('user_id')

    # 소유자 확인
    conversation = await ai_model.find_conversation_by_id(conversation_id, db)
    if not conversation or conversation['user_id'] != user_id:
        return {'status': False, 'message': 'NOT_FOUND_OR_NOT_OWNER'}

    # AI 설정 로드
    config = await ai_model.get_config(db)
    if not config:
        return {'status': False, 'message': 'AI_NOT_CONFIGURED'}

    # 사용자 메시지 저장
    await ai_model.create_message(conversation_id, 'user', body.content, db)
    await ai_model.update_conversation_timestamp(conversation_id, db)

    # 대화 이력 로드
    history = await ai_model.find_messages_by_conversation(conversation_id, db)

    # 태스크 요약
    task_summary = await _get_task_summary(user_id, db)
    system_prompt = _build_system_prompt(task_summary)

    provider = config['provider']
    api_key = config['api_key']
    model = config['model']

    async def generate():
        full_response = ""

        try:
            if provider == 'anthropic':
                url = "https://api.anthropic.com/v1/messages"
                headers = {
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                }
                messages = [
                    {"role": m['role'], "content": m['content']}
                    for m in history if m['role'] in ('user', 'assistant')
                ]
                payload = {
                    "model": model,
                    "max_tokens": 4096,
                    "system": system_prompt,
                    "messages": messages,
                    "stream": True,
                }

                async with httpx.AsyncClient(timeout=120.0) as client:
                    async with client.stream("POST", url, json=payload, headers=headers) as response:
                        if response.status_code != 200:
                            body = await response.aread()
                            _log_llm_api_error("Anthropic", response.status_code, body)
                            yield f"data: {json.dumps({'error': f'API error ({response.status_code})'})}\n\n"
                            return
                        async for line in response.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            data_str = line[6:]
                            if data_str == "[DONE]":
                                break
                            try:
                                data = json.loads(data_str)
                                if data.get("type") == "content_block_delta":
                                    text = data.get("delta", {}).get("text", "")
                                    if text:
                                        full_response += text
                                        yield f"data: {json.dumps({'content': text})}\n\n"
                            except json.JSONDecodeError:
                                continue

            else:  # openai
                url = "https://api.openai.com/v1/chat/completions"
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                }
                messages = [{"role": "system", "content": system_prompt}]
                messages.extend([
                    {"role": m['role'], "content": m['content']}
                    for m in history if m['role'] in ('user', 'assistant')
                ])
                payload = {
                    "model": model,
                    "messages": messages,
                    "stream": True,
                }

                async with httpx.AsyncClient(timeout=120.0) as client:
                    async with client.stream("POST", url, json=payload, headers=headers) as response:
                        if response.status_code != 200:
                            body = await response.aread()
                            _log_llm_api_error("OpenAI", response.status_code, body)
                            yield f"data: {json.dumps({'error': f'API error ({response.status_code})'})}\n\n"
                            return
                        async for line in response.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            data_str = line[6:]
                            if data_str == "[DONE]":
                                break
                            try:
                                data = json.loads(data_str)
                                text = (data.get("choices", [{}])[0]
                                        .get("delta", {}).get("content", ""))
                                if text:
                                    full_response += text
                                    yield f"data: {json.dumps({'content': text})}\n\n"
                            except (json.JSONDecodeError, IndexError):
                                continue

        except httpx.HTTPError as e:
            # 예외 메시지엔 호스트/연결 상세가 섞일 수 있어 타입만 남긴다(SEC-05).
            logger.error("LLM API request failed: %s", type(e).__name__)
            yield f"data: {json.dumps({'error': 'LLM API request failed'})}\n\n"
            return

        # 스트리밍 완료 후 별도 세션으로 DB 저장
        if full_response:
            import db_engine
            async for session in db_engine.session():
                msg = await ai_model.create_message(
                    conversation_id, 'assistant', full_response, session
                )
                await ai_model.update_conversation_timestamp(conversation_id, session)
                yield f"data: {json.dumps({'done': True, 'message_id': msg['message_id']})}\n\n"
                break
        else:
            yield f"data: {json.dumps({'done': True, 'message_id': None})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
