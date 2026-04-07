import re
from typing import Optional, List
from pydantic import BaseModel, field_validator


class WorkflowStatusCreate(BaseModel):
    key: str
    label: str
    color: str = '#9CA3AF'
    category: str

    @field_validator('key')
    @classmethod
    def validate_key(cls, v):
        v = v.strip().lower()
        if not re.match(r'^[a-z][a-z0-9_]{0,49}$', v):
            raise ValueError('key must be lowercase letters/numbers/underscore, starting with a letter')
        return v

    @field_validator('category')
    @classmethod
    def validate_category(cls, v):
        if v not in ('todo', 'in_progress', 'done', 'cancelled'):
            raise ValueError('category must be "todo", "in_progress", "done", or "cancelled"')
        return v


class WorkflowStatusUpdate(BaseModel):
    label: Optional[str] = None
    color: Optional[str] = None
    category: Optional[str] = None
    is_default: Optional[bool] = None

    @field_validator('category')
    @classmethod
    def validate_category(cls, v):
        if v is not None and v not in ('todo', 'in_progress', 'done', 'cancelled'):
            raise ValueError('category must be "todo", "in_progress", "done", or "cancelled"')
        return v


class WorkflowStatusReorder(BaseModel):
    items: List[dict]  # [{'id': ..., 'sort_order': ...}]
