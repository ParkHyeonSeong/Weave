from typing import Optional
from datetime import date
from pydantic import BaseModel


class EpicCreate(BaseModel):
    epic_name: str
    description: Optional[str] = None
    status: str = 'todo'
    color: str = '#5E6AD2'
    start_date: Optional[date] = None
    due_date: Optional[date] = None


class EpicUpdate(BaseModel):
    epic_name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    color: Optional[str] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
