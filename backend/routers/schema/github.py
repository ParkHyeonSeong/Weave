import re
from pydantic import BaseModel, field_validator

_OWNER_REPO_RE = re.compile(r'^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$')


class IntegrationCreate(BaseModel):
    repo_full_name: str
    installation_id: int

    @field_validator('repo_full_name')
    @classmethod
    def validate_repo_full_name(cls, v):
        if not _OWNER_REPO_RE.match(v):
            raise ValueError('repo_full_name must be owner/repo (GitHub allowed chars only)')
        return v

    @field_validator('installation_id')
    @classmethod
    def validate_installation_id(cls, v):
        if v <= 0:
            raise ValueError('installation_id must be a positive integer')
        return v


class IntegrationToggle(BaseModel):
    enabled: bool


class RefLinkCreate(BaseModel):
    html_url: str  # PR URL만 받는다; 백엔드가 owner/repo/number를 파싱(프론트는 URL만 전송)
