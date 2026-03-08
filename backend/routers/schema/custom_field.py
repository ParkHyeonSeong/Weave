from typing import Optional, List
from pydantic import BaseModel, field_validator


class CustomFieldCreate(BaseModel):
    field_name: str
    field_type: str
    field_options: Optional[List[str]] = None
    is_required: bool = False

    @field_validator('field_type')
    @classmethod
    def validate_field_type(cls, v):
        allowed = ('text', 'number', 'select', 'date', 'checkbox', 'url')
        if v not in allowed:
            raise ValueError(f'field_type must be one of {allowed}')
        return v


class CustomFieldUpdate(BaseModel):
    field_name: Optional[str] = None
    field_type: Optional[str] = None
    field_options: Optional[List[str]] = None
    is_required: Optional[bool] = None

    @field_validator('field_type')
    @classmethod
    def validate_field_type(cls, v):
        if v is None:
            return v
        allowed = ('text', 'number', 'select', 'date', 'checkbox', 'url')
        if v not in allowed:
            raise ValueError(f'field_type must be one of {allowed}')
        return v


class CustomFieldReorder(BaseModel):
    items: List[dict]  # [{'id': ..., 'sort_order': ...}]
