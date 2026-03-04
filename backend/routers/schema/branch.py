from typing import Optional
from pydantic import BaseModel, field_validator


class BranchCreate(BaseModel):
    branch_name: str
    description: Optional[str] = None
    visibility: str = 'private'

    @field_validator('visibility')
    @classmethod
    def validate_visibility(cls, v):
        if v not in ('public', 'private'):
            raise ValueError('visibility must be "public" or "private"')
        return v
