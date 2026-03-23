from pydantic import BaseModel, field_validator


def _is_empty_html(v: str) -> bool:
    """HTML 콘텐츠가 실질적으로 비어있는지 확인"""
    if not v:
        return True
    stripped = v.strip()
    return not stripped or stripped == '<p></p>'


class AnnotationCreate(BaseModel):
    quoted_text: str
    prefix_context: str = ''
    suffix_context: str = ''
    anchor_node_path: str = ''
    anchor_offset: int = 0
    anchor_length: int = 0
    content: str  # 첫 댓글 HTML

    @field_validator('quoted_text')
    @classmethod
    def validate_quoted_text(cls, v):
        if not v or not v.strip():
            raise ValueError('quoted_text is required')
        if len(v) > 2000:
            raise ValueError('quoted_text must be 2000 characters or less')
        return v

    @field_validator('prefix_context', 'suffix_context')
    @classmethod
    def validate_context(cls, v):
        if len(v) > 100:
            return v[:100]
        return v

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        if _is_empty_html(v):
            raise ValueError('content is required')
        if len(v) > 10000:
            raise ValueError('content must be 10000 characters or less')
        return v


class AnnotationUpdate(BaseModel):
    status: str

    @field_validator('status')
    @classmethod
    def validate_status(cls, v):
        if v not in ('open', 'resolved'):
            raise ValueError('status must be "open" or "resolved"')
        return v


class ReplyCreate(BaseModel):
    content: str

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        if _is_empty_html(v):
            raise ValueError('content is required')
        if len(v) > 10000:
            raise ValueError('content must be 10000 characters or less')
        return v


class ReplyUpdate(BaseModel):
    content: str

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        if _is_empty_html(v):
            raise ValueError('content is required')
        if len(v) > 10000:
            raise ValueError('content must be 10000 characters or less')
        return v
