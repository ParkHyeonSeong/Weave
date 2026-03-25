from pydantic import BaseModel


class EventTaskLinkCreate(BaseModel):
    task_id: int
