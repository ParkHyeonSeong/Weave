from typing import Optional
from pydantic import BaseModel, field_validator
from library.html_validator import is_empty_html


def _validate_content(v: str) -> str:
    if is_empty_html(v):
        raise ValueError('content is required')
    if len(v) > 10000:
        raise ValueError('content must be 10000 characters or less')
    return v


class CommentCreate(BaseModel):
    content: str
    parent_comment_id: Optional[int] = None

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        return _validate_content(v)


class CommentUpdate(BaseModel):
    content: str

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        return _validate_content(v)
