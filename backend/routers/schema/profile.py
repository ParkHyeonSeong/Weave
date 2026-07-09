from typing import List, Optional
from pydantic import BaseModel, field_validator

from library.crypto import MIN_PASSWORD_LENGTH
from library.user_avatar import AVATAR_COLORS


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
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f'password must be at least {MIN_PASSWORD_LENGTH} characters')
        return v


class ForceChangePassword(BaseModel):
    new_password: str
    confirm_password: str

    @field_validator('new_password')
    @classmethod
    def validate_new_password(cls, v):
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f'password must be at least {MIN_PASSWORD_LENGTH} characters')
        return v


class UpdateAvatarColor(BaseModel):
    color: Optional[str] = None  # None = 자동(해시 색)으로 복귀

    @field_validator('color')
    @classmethod
    def validate_color(cls, v):
        if v is None:
            return None
        if v not in AVATAR_COLORS:
            raise ValueError('invalid avatar color')
        return v


class UpdateUiPrefs(BaseModel):
    sidebar_order: Optional[dict] = None
    hidden: Optional[dict] = None
    launchpad_order: Optional[List[str]] = None
    widget_layout: Optional[List[str]] = None
    home_controls: Optional[dict] = None
    saved_view_pins: Optional[dict] = None  # { "<branchId>|global": [view_id, ...] } per-user 핀 순서
    comment_sort: Optional[str] = None  # 'newest' | 'oldest' — 태스크 댓글 정렬 선호

    @field_validator('comment_sort')
    @classmethod
    def validate_comment_sort(cls, v):
        if v is None:
            return None
        if v not in ('newest', 'oldest'):
            raise ValueError("comment_sort must be 'newest' or 'oldest'")
        return v
