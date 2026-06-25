"""Task 서브리소스(label/assignee/custom field) 부분 add/remove 요청 스키마."""
from pydantic import BaseModel


class TaskLabelAdd(BaseModel):
    label_id: int
