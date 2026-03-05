from typing import Optional, List
from datetime import date
from pydantic import BaseModel, field_validator


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    task_type: str = 'task'
    status: str = 'todo'
    priority: str = 'medium'
    epic_id: Optional[int] = None
    sprint_id: Optional[int] = None
    parent_task_id: Optional[int] = None
    assignee_id: Optional[int] = None
    label_ids: Optional[List[int]] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None

    # task_type 검증은 controller에서 branch의 task_type_config로 동적 검증

    @field_validator('status')
    @classmethod
    def validate_status(cls, v):
        if v not in ('todo', 'in_progress', 'done'):
            raise ValueError('status must be "todo", "in_progress", or "done"')
        return v

    @field_validator('priority')
    @classmethod
    def validate_priority(cls, v):
        if v not in ('low', 'medium', 'high', 'urgent'):
            raise ValueError('priority must be "low", "medium", "high", or "urgent"')
        return v


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    task_type: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    epic_id: Optional[int] = None
    sprint_id: Optional[int] = None
    assignee_id: Optional[int] = None
    label_ids: Optional[List[int]] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None

    @field_validator('status')
    @classmethod
    def validate_status(cls, v):
        if v is not None and v not in ('todo', 'in_progress', 'done'):
            raise ValueError('status must be "todo", "in_progress", or "done"')
        return v

    @field_validator('priority')
    @classmethod
    def validate_priority(cls, v):
        if v is not None and v not in ('low', 'medium', 'high', 'urgent'):
            raise ValueError('priority must be "low", "medium", "high", or "urgent"')
        return v
