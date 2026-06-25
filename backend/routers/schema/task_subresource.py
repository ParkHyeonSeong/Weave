"""Task 서브리소스(label/assignee/custom field) 부분 add/remove 요청 스키마."""
from typing import Optional

from pydantic import BaseModel, field_validator


class TaskLabelAdd(BaseModel):
    label_id: int


class TaskCustomFieldSet(BaseModel):
    field_id: int
    value: Optional[object] = None  # 필드 타입별 네이티브 값(number/str/bool/None=clear)


class TaskAssigneeAdd(BaseModel):
    user_id: int
    role: str = 'sub'

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in ('main', 'sub'):
            raise ValueError('role must be "main" or "sub"')
        return v
