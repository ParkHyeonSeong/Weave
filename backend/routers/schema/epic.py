from typing import Optional
from datetime import date
from pydantic import BaseModel, field_validator


class EpicCreate(BaseModel):
    epic_name: str
    description: Optional[str] = None
    status: str = 'todo'
    color: str = '#5E6AD2'
    start_date: Optional[date] = None
    due_date: Optional[date] = None

    @field_validator('status')
    @classmethod
    def validate_status(cls, v):
        if v not in ('todo', 'in_progress', 'done'):
            raise ValueError('status must be "todo", "in_progress", or "done"')
        return v


class EpicUpdate(BaseModel):
    epic_name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    color: Optional[str] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None

    @field_validator('status')
    @classmethod
    def validate_status(cls, v):
        if v is not None and v not in ('todo', 'in_progress', 'done'):
            raise ValueError('status must be "todo", "in_progress", or "done"')
        return v
