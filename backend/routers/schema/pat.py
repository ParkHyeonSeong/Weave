from typing import Optional

from pydantic import BaseModel, field_validator


class CreateToken(BaseModel):
    name: str
    expires_in_days: Optional[int] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        if len(v) > 100:
            raise ValueError("name must be at most 100 characters")
        return v

    @field_validator("expires_in_days")
    @classmethod
    def validate_expiry(cls, v):
        if v is not None and v <= 0:
            raise ValueError("expires_in_days must be a positive integer")
        return v
