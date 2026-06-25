from typing import Optional, List
from datetime import date
from pydantic import BaseModel, field_validator


class AssigneeInput(BaseModel):
    main: Optional[int] = None
    sub: Optional[List[int]] = None


class FilterSortItem(BaseModel):
    field: str
    dir: str = "asc"


class TaskQuery(BaseModel):
    filter: Optional[dict] = None
    sort: List[FilterSortItem] = []
    group_by: Optional[str] = None
    page: int = 1
    page_size: int = 50
    # limit/offset 직접 지정 시 page/page_size보다 우선(MCP offset 페이지네이션용 — 배수 제약 없음)
    limit: Optional[int] = None
    offset: Optional[int] = None
    # 있으면 서버가 뷰의 filter/group_by/sort를 로드(body의 filter/group_by/sort는 무시)
    saved_view_id: Optional[int] = None


class TaskQueryCross(TaskQuery):
    scope: str = "my"


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    task_type: str = 'task'
    status: str = 'todo'
    priority: str = 'medium'
    epic_id: Optional[int] = None
    sprint_id: Optional[int] = None
    parent_task_id: Optional[int] = None
    assignees: Optional[AssigneeInput] = None
    label_ids: Optional[List[int]] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    custom_fields: Optional[dict] = None

    # task_type 검증은 controller에서 branch의 task_type_config로 동적 검증
    # status 검증은 controller에서 branch의 workflow_status로 동적 검증

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
    parent_task_id: Optional[int] = None
    assignees: Optional[AssigneeInput] = None
    label_ids: Optional[List[int]] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    custom_fields: Optional[dict] = None
    dry_run: bool = False  # True면 검증만 거치고 DB 쓰기 없이 변경 diff 반환

    @field_validator('priority')
    @classmethod
    def validate_priority(cls, v):
        if v is not None and v not in ('low', 'medium', 'high', 'urgent'):
            raise ValueError('priority must be "low", "medium", "high", or "urgent"')
        return v


class TaskReorder(BaseModel):
    task_ids: List[int]
    sprint_id: Optional[int] = None  # null = backlog
    after_task_id: Optional[int] = None  # null = 맨 위에 삽입
