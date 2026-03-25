from typing import List, Optional
from pydantic import BaseModel, field_validator


class UpdateUsername(BaseModel):
    username: str

    @field_validator('username')
    @classmethod
    def validate_username(cls, v):
        v = v.strip()
        if not v:
            raise ValueError('username must not be empty')
        if len(v) > 100:
            raise ValueError('username must be 100 characters or fewer')
        return v


class UpdatePassword(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str

    @field_validator('new_password')
    @classmethod
    def validate_new_password(cls, v):
        if len(v) < 6:
            raise ValueError('password must be at least 6 characters')
        return v


class ForceChangePassword(BaseModel):
    new_password: str
    confirm_password: str

    @field_validator('new_password')
    @classmethod
    def validate_new_password(cls, v):
        if len(v) < 6:
            raise ValueError('password must be at least 6 characters')
        return v


class UpdateSidebarOrder(BaseModel):
    branches: Optional[List[int]] = None
    canvases: Optional[List[int]] = None
