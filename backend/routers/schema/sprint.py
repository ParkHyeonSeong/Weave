from typing import Optional
from datetime import date
from pydantic import BaseModel, field_validator


class SprintCreate(BaseModel):
    sprint_name: str
    goal: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class SprintUpdate(BaseModel):
    sprint_name: Optional[str] = None
    goal: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[str] = None

    @field_validator('status')
    @classmethod
    def validate_status(cls, v):
        if v is not None and v not in ('future', 'active', 'closed'):
            raise ValueError('status must be "future", "active", or "closed"')
        return v
