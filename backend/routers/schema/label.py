from typing import Optional
from pydantic import BaseModel


class LabelCreate(BaseModel):
    label_name: str
    color: str = '#5E6AD2'


class LabelUpdate(BaseModel):
    label_name: Optional[str] = None
    color: Optional[str] = None
