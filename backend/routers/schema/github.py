from pydantic import BaseModel


class IntegrationCreate(BaseModel):
    repo_full_name: str
    installation_id: int


class IntegrationToggle(BaseModel):
    enabled: bool


class RefLinkCreate(BaseModel):
    html_url: str  # PR URL만 받는다; 백엔드가 owner/repo/number를 파싱(프론트는 URL만 전송)
