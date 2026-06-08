from typing import Optional
from pydantic import BaseModel, field_validator

VALID_VISIBILITY = ('public', 'private')
VALID_ROLES = ('member', 'admin')
VALID_CADENCE = ('weekly', 'biweekly', 'every_n_weeks', 'monthly', 'manual')
VALID_TEMPLATE = ('kpt',)


class ScrumBoardCreate(BaseModel):
    name: str
    icon: Optional[str] = None
    color: Optional[str] = '#16A34A'
    visibility: str = 'private'
    retro_cadence: str = 'weekly'
    retro_interval_weeks: Optional[int] = None
    retro_template: str = 'kpt'
    retro_anchor_weekday: int = 4

    @field_validator('name')
    @classmethod
    def validate_name(cls, v):
        v = v.strip()
        if not v:
            raise ValueError('name is required')
        if len(v) > 300:
            raise ValueError('name too long')
        return v

    @field_validator('visibility')
    @classmethod
    def validate_visibility(cls, v):
        if v not in VALID_VISIBILITY:
            raise ValueError(f'visibility must be one of {VALID_VISIBILITY}')
        return v

    @field_validator('retro_cadence')
    @classmethod
    def validate_cadence(cls, v):
        if v not in VALID_CADENCE:
            raise ValueError(f'retro_cadence must be one of {VALID_CADENCE}')
        return v

    @field_validator('retro_template')
    @classmethod
    def validate_template(cls, v):
        if v not in VALID_TEMPLATE:
            raise ValueError(f'retro_template must be one of {VALID_TEMPLATE}')
        return v

    @field_validator('retro_anchor_weekday')
    @classmethod
    def validate_weekday(cls, v):
        if v < 0 or v > 4:
            raise ValueError('retro_anchor_weekday must be 0..4 (Mon..Fri)')
        return v


class ScrumBoardUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    visibility: Optional[str] = None
    retro_cadence: Optional[str] = None
    retro_interval_weeks: Optional[int] = None
    retro_template: Optional[str] = None
    retro_anchor_weekday: Optional[int] = None

    @field_validator('visibility')
    @classmethod
    def validate_visibility(cls, v):
        if v is not None and v not in VALID_VISIBILITY:
            raise ValueError(f'visibility must be one of {VALID_VISIBILITY}')
        return v

    @field_validator('retro_cadence')
    @classmethod
    def validate_cadence(cls, v):
        if v is not None and v not in VALID_CADENCE:
            raise ValueError(f'retro_cadence must be one of {VALID_CADENCE}')
        return v

    @field_validator('retro_template')
    @classmethod
    def validate_template(cls, v):
        if v is not None and v not in VALID_TEMPLATE:
            raise ValueError(f'retro_template must be one of {VALID_TEMPLATE}')
        return v

    @field_validator('retro_anchor_weekday')
    @classmethod
    def validate_weekday(cls, v):
        if v is not None and (v < 0 or v > 4):
            raise ValueError('retro_anchor_weekday must be 0..4 (Mon..Fri)')
        return v


class ScrumMemberAdd(BaseModel):
    user_id: int
    role: str = 'member'

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in VALID_ROLES:
            raise ValueError(f'role must be one of {VALID_ROLES}')
        return v


class ScrumMemberRoleUpdate(BaseModel):
    role: str

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in VALID_ROLES:
            raise ValueError(f'role must be one of {VALID_ROLES}')
        return v
