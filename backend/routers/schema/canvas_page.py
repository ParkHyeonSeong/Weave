from typing import Optional
from pydantic import BaseModel, field_validator

MAX_CONTENT_LENGTH = 300_000


class CanvasPageCreate(BaseModel):
    title: str
    content: Optional[str] = ''
    parent_page_id: Optional[int] = None
    type: str = 'document'

    @field_validator('type')
    @classmethod
    def validate_type(cls, v):
        if v not in ('document', 'folder', 'typst'):
            raise ValueError('type must be "document", "folder", or "typst"')
        return v

    @field_validator('content')
    @classmethod
    def validate_content_length(cls, v):
        if v is not None and len(v) > MAX_CONTENT_LENGTH:
            raise ValueError(f'content exceeds maximum length of {MAX_CONTENT_LENGTH} characters')
        return v


class CanvasPageUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    parent_page_id: Optional[int] = None
    position: Optional[int] = None
    wide_mode: Optional[bool] = None

    @field_validator('content')
    @classmethod
    def validate_content_length(cls, v):
        if v is not None and len(v) > MAX_CONTENT_LENGTH:
            raise ValueError(f'content exceeds maximum length of {MAX_CONTENT_LENGTH} characters')
        return v


class CanvasPageMove(BaseModel):
    parent_page_id: Optional[int] = None
    position: int
