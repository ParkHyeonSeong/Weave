from typing import Optional, List
from pydantic import BaseModel


class SavedViewCreate(BaseModel):
    name: str
    scope_branch_id: Optional[int] = None  # None = 개인 뷰
    filter_spec: dict = {}
    group_by: Optional[str] = None
    sort: Optional[List[dict]] = None
    columns: Optional[List[str]] = None
    visibility: str = "private"  # 'private' | 'shared'
    scope: Optional[str] = None  # 개인 뷰의 'my'|'all'(크로스 스코프). 브랜치 뷰는 None


class SavedViewUpdate(BaseModel):
    name: Optional[str] = None
    filter_spec: Optional[dict] = None
    group_by: Optional[str] = None
    sort: Optional[List[dict]] = None
    columns: Optional[List[str]] = None
    visibility: Optional[str] = None
    scope: Optional[str] = None
