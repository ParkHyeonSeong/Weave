import re
from typing import Optional
from pydantic import BaseModel, field_validator


HEX_COLOR_RE = re.compile(r'^#[0-9A-Fa-f]{6}$')
ICON_PREFIX_RE = re.compile(r'^(lucide|emoji|image):.+')
LUCIDE_NAME_RE = re.compile(r'^[a-z][a-z0-9-]{0,48}$')


class CanvasCreate(BaseModel):
    canvas_name: str
    key: str
    description: Optional[str] = None
    visibility: str = 'private'
    branch_id: Optional[int] = None

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


class CanvasUpdate(BaseModel):
    canvas_name: Optional[str] = None
    key: Optional[str] = None
    description: Optional[str] = None
    visibility: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None

    @field_validator('key')
    @classmethod
    def validate_key(cls, v):
        if v is not None:
            v = v.strip().upper()
            if not re.match(r'^[A-Z][A-Z0-9]{1,9}$', v):
                raise ValueError('key must be 2-10 uppercase letters/numbers, starting with a letter')
        return v

    @field_validator('visibility')
    @classmethod
    def validate_visibility(cls, v):
        if v is not None and v not in ('public', 'private'):
            raise ValueError('visibility must be "public" or "private"')
        return v

    @field_validator('color')
    @classmethod
    def validate_color(cls, v):
        if v is None:
            return v
        if not HEX_COLOR_RE.match(v):
            raise ValueError('color must be #RRGGBB hex')
        return v

    @field_validator('icon')
    @classmethod
    def validate_icon(cls, v):
        if v is None:
            return v
        if len(v) > 50:
            raise ValueError('icon string too long')
        if ICON_PREFIX_RE.match(v) or LUCIDE_NAME_RE.match(v):
            return v
        raise ValueError('icon must be prefixed (lucide:|emoji:|image:) or a lucide name')


class CanvasMemberAdd(BaseModel):
    user_id: int
    role: str = 'member'

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in ('admin', 'member'):
            raise ValueError('role must be "admin" or "member"')
        return v


class CanvasMemberRoleUpdate(BaseModel):
    role: str

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in ('admin', 'member'):
            raise ValueError('role must be "admin" or "member"')
        return v
