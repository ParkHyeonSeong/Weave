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

    @field_validator('task_type')
    @classmethod
    def validate_task_type(cls, v):
        if v not in ('task', 'bug', 'story'):
            raise ValueError('task_type must be "task", "bug", or "story"')
        return v

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

    @field_validator('task_type')
    @classmethod
    def validate_task_type(cls, v):
        if v is not None and v not in ('task', 'bug', 'story'):
            raise ValueError('task_type must be "task", "bug", or "story"')
        return v

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
