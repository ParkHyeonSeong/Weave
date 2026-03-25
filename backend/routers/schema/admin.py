from typing import Optional
from pydantic import BaseModel, field_validator


class CreateUser(BaseModel):
    email: str
    username: str
    password: str
    role: str = 'member'

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in ('admin', 'member'):
            raise ValueError('role must be "admin" or "member"')
        return v

    @field_validator('password')
    @classmethod
    def validate_password(cls, v):
        if len(v) < 6:
            raise ValueError('password must be at least 6 characters')
        return v


class UpdateUserRole(BaseModel):
    role: str

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in ('admin', 'member'):
            raise ValueError('role must be "admin" or "member"')
        return v


class UpdateUserStatus(BaseModel):
    status: str

    @field_validator('status')
    @classmethod
    def validate_status(cls, v):
        if v not in ('active', 'rejected'):
            raise ValueError('status must be "active" or "rejected"')
        return v


class ResetUserPassword(BaseModel):
    new_password: Optional[str] = None

    @field_validator('new_password')
    @classmethod
    def validate_password(cls, v):
        if v is not None and len(v) < 6:
            raise ValueError('password must be at least 6 characters')
        return v
