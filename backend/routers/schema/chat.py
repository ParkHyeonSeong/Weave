from typing import Optional, List
from pydantic import BaseModel, field_validator


class ChatRoomCreate(BaseModel):
    room_type: str = 'dm'
    room_name: Optional[str] = None
    member_ids: List[int]

    @field_validator('room_type')
    @classmethod
    def validate_room_type(cls, v):
        if v not in ('dm', 'group'):
            raise ValueError('room_type must be "dm" or "group"')
        return v


class ChatRoomRename(BaseModel):
    room_name: str

    @field_validator('room_name')
    @classmethod
    def validate_room_name(cls, v):
        v = v.strip()
        if not v:
            raise ValueError('room_name must not be empty')
        if len(v) > 200:
            raise ValueError('room_name must be 200 characters or fewer')
        return v


class ChatMessageSend(BaseModel):
    content: str

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        v = v.strip()
        if not v:
            raise ValueError('content must not be empty')
        return v
