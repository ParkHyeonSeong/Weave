from typing import Optional
from pydantic import BaseModel, field_validator
from library.html_validator import is_empty_html


class IssueCreate(BaseModel):
    title: str
    body: Optional[str] = None

    @field_validator('title')
    @classmethod
    def validate_title(cls, v):
        if not v or not v.strip():
            raise ValueError('title is required')
        if len(v) > 500:
            raise ValueError('title must be 500 characters or less')
        return v.strip()

    @field_validator('body')
    @classmethod
    def validate_body(cls, v):
        if v is not None and len(v) > 50000:
            raise ValueError('body must be 50000 characters or less')
        return v


class IssueUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    status: Optional[str] = None

    @field_validator('title')
    @classmethod
    def validate_title(cls, v):
        if v is not None:
            if not v.strip():
                raise ValueError('title cannot be empty')
            if len(v) > 500:
                raise ValueError('title must be 500 characters or less')
            return v.strip()
        return v

    @field_validator('body')
    @classmethod
    def validate_body(cls, v):
        if v is not None and len(v) > 50000:
            raise ValueError('body must be 50000 characters or less')
        return v

    @field_validator('status')
    @classmethod
    def validate_status(cls, v):
        if v is not None and v not in ('open', 'closed'):
            raise ValueError('status must be "open" or "closed"')
        return v


class CommentCreate(BaseModel):
    content: str

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        if is_empty_html(v):
            raise ValueError('content is required')
        if len(v) > 10000:
            raise ValueError('content must be 10000 characters or less')
        return v


class CommentUpdate(BaseModel):
    content: str

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        if is_empty_html(v):
            raise ValueError('content is required')
        if len(v) > 10000:
            raise ValueError('content must be 10000 characters or less')
        return v
