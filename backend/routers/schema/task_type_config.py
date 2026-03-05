import re
from typing import Optional
from pydantic import BaseModel, field_validator


class TaskTypeCreate(BaseModel):
    type_key: str
    type_name: str
    icon: str = 'CheckSquare'
    color: str = '#5E6AD2'

    @field_validator('type_key')
    @classmethod
    def validate_type_key(cls, v):
        v = v.strip().lower()
        if not re.match(r'^[a-z][a-z0-9_]{0,49}$', v):
            raise ValueError('type_key must be lowercase letters/numbers/underscore, starting with a letter')
        return v


class TaskTypeUpdate(BaseModel):
    type_name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
