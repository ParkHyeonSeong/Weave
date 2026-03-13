from typing import Optional
from datetime import date
from pydantic import BaseModel, field_validator


class ScheduleEventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    start_date: date
    end_date: Optional[date] = None
    color: Optional[str] = '#5E6AD2'

    @field_validator('end_date')
    @classmethod
    def end_after_start(cls, v, info):
        if v and info.data.get('start_date') and v < info.data['start_date']:
            raise ValueError('end_date must be >= start_date')
        return v


class ScheduleEventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    color: Optional[str] = None
