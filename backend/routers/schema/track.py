from typing import Optional, List, Literal
from pydantic import BaseModel, Field, field_validator, model_validator


VALID_VISIBILITY = ('public', 'private')
VALID_ROLES = ('viewer', 'editor', 'owner')
VALID_VIEWS = ('flow', 'timeline', 'tree')


class TrackCreate(BaseModel):
    track_name: str
    description: Optional[str] = None
    color: Optional[str] = '#5E6AD2'
    icon: Optional[str] = None
    visibility: str = 'private'
    default_view: str = 'flow'
    participating_branch_ids: Optional[List[int]] = None

    @field_validator('track_name')
    @classmethod
    def validate_name(cls, v):
        v = v.strip()
        if not v:
            raise ValueError('track_name is required')
        if len(v) > 300:
            raise ValueError('track_name too long')
        return v

    @field_validator('visibility')
    @classmethod
    def validate_visibility(cls, v):
        if v not in VALID_VISIBILITY:
            raise ValueError(f'visibility must be one of {VALID_VISIBILITY}')
        return v

    @field_validator('default_view')
    @classmethod
    def validate_view(cls, v):
        if v not in VALID_VIEWS:
            raise ValueError(f'default_view must be one of {VALID_VIEWS}')
        return v


class TrackUpdate(BaseModel):
    track_name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    visibility: Optional[str] = None
    default_view: Optional[str] = None

    @field_validator('visibility')
    @classmethod
    def validate_visibility(cls, v):
        if v is not None and v not in VALID_VISIBILITY:
            raise ValueError(f'visibility must be one of {VALID_VISIBILITY}')
        return v

    @field_validator('default_view')
    @classmethod
    def validate_view(cls, v):
        if v is not None and v not in VALID_VIEWS:
            raise ValueError(f'default_view must be one of {VALID_VIEWS}')
        return v


class TrackMemberAdd(BaseModel):
    user_id: int
    role: str = 'editor'

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in VALID_ROLES:
            raise ValueError(f'role must be one of {VALID_ROLES}')
        return v


class TrackMemberRoleUpdate(BaseModel):
    role: str

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in VALID_ROLES:
            raise ValueError(f'role must be one of {VALID_ROLES}')
        return v


class TrackBranchAdd(BaseModel):
    branch_id: int


class TrackBranchOverride(BaseModel):
    display_name_override: Optional[str] = None
    color_override: Optional[str] = None


class TrackItemAdd(BaseModel):
    source_task_id: int
    position_x: Optional[float] = 0
    position_y: Optional[float] = 0


class TrackItemsBulkAdd(BaseModel):
    """Epic/Sprint/Filter 모드에서 한 번에 N개의 task를 Track에 추가.
    각 task는 sequentially 처리 (참여 branch 자동 합류 + 중복 무시).
    scope_mode='sprint'|'epic' + scope_id로 명시적 sidebar group marker 등록.
    'filter' 또는 미지정이면 task들의 sprint를 자동 scope로 합류.
    """
    source_task_ids: List[int] = Field(min_length=1, max_length=200)
    scope_mode: Optional[Literal['sprint', 'epic', 'filter']] = None
    scope_id: Optional[int] = None

    @model_validator(mode='after')
    def _check_scope(self):
        if self.scope_mode in ('sprint', 'epic') and self.scope_id is None:
            raise ValueError("scope_id required when scope_mode is 'sprint' or 'epic'")
        return self


class _PositionEntry(BaseModel):
    item_id: int
    position_x: float
    position_y: float


class TrackItemPositionsUpdate(BaseModel):
    positions: List[_PositionEntry] = Field(min_length=1, max_length=500)


VALID_LINK_TYPES = ('flow_to', 'relates_to')


class TrackLinkAdd(BaseModel):
    source_item_id: int
    target_item_id: int
    link_type: str = 'flow_to'
    materialize: bool = False

    @field_validator('link_type')
    @classmethod
    def validate_type(cls, v):
        if v not in VALID_LINK_TYPES:
            raise ValueError(f'link_type must be one of {VALID_LINK_TYPES}')
        return v
