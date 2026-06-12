from typing import Optional
from pydantic import BaseModel, Field, field_validator

# 단일 AI 채팅 메시지 최대 길이(SEC-26/SEC-11). 정상 메시지(보통 수백~수천 자)보다 훨씬
# 크되 대량 본문으로 LLM 비용/메모리를 고갈시키지 못하도록 앱 레벨 상한을 둔다.
AI_MESSAGE_MAX_LENGTH = 50_000


class AIConfigUpdate(BaseModel):
    provider: str
    api_key: str
    model: str

    @field_validator('provider')
    @classmethod
    def validate_provider(cls, v):
        if v not in ('anthropic', 'openai'):
            raise ValueError('provider must be "anthropic" or "openai"')
        return v


class AIConversationCreate(BaseModel):
    title: Optional[str] = None


class AIChatMessage(BaseModel):
    content: str = Field(max_length=AI_MESSAGE_MAX_LENGTH)

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        v = v.strip()
        if not v:
            raise ValueError('content must not be empty')
        return v
