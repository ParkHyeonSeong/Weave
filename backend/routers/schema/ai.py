from typing import Optional
from pydantic import BaseModel, field_validator


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
    content: str

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        v = v.strip()
        if not v:
            raise ValueError('content must not be empty')
        return v
