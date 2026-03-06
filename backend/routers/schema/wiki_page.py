from typing import Optional
from pydantic import BaseModel, field_validator


class WikiPageCreate(BaseModel):
    title: str
    content: Optional[str] = ''
    parent_page_id: Optional[int] = None
    type: str = 'document'

    @field_validator('type')
    @classmethod
    def validate_type(cls, v):
        if v not in ('document', 'folder'):
            raise ValueError('type must be "document" or "folder"')
        return v


class WikiPageUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    parent_page_id: Optional[int] = None
    position: Optional[int] = None


class WikiPageMove(BaseModel):
    parent_page_id: Optional[int] = None
    position: int
