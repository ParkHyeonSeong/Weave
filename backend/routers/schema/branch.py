import re
from typing import Optional
from pydantic import BaseModel, field_validator


class BranchCreate(BaseModel):
    branch_name: str
    key: str
    description: Optional[str] = None
    visibility: str = 'private'

    @field_validator('key')
    @classmethod
    def validate_key(cls, v):
        v = v.strip().upper()
        if not re.match(r'^[A-Z][A-Z0-9]{1,9}$', v):
            raise ValueError('key must be 2-10 uppercase letters/numbers, starting with a letter')
        return v

    @field_validator('visibility')
    @classmethod
    def validate_visibility(cls, v):
        if v not in ('public', 'private'):
            raise ValueError('visibility must be "public" or "private"')
        return v


class BranchUpdate(BaseModel):
    branch_name: Optional[str] = None
    description: Optional[str] = None
    visibility: Optional[str] = None

    @field_validator('visibility')
    @classmethod
    def validate_visibility(cls, v):
        if v is not None and v not in ('public', 'private'):
            raise ValueError('visibility must be "public" or "private"')
        return v


class BranchMemberAdd(BaseModel):
    user_id: int
    role: str = 'member'

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in ('admin', 'member'):
            raise ValueError('role must be "admin" or "member"')
        return v


class BranchMemberRoleUpdate(BaseModel):
    role: str

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in ('admin', 'member'):
            raise ValueError('role must be "admin" or "member"')
        return v
