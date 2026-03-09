from pydantic import BaseModel


class DependencyCreate(BaseModel):
    source_task_id: int
    target_task_id: int
    dep_type: str = 'finish_to_start'
