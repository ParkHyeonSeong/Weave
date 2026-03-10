from pydantic import BaseModel


class PageLinkCreate(BaseModel):
    page_id: int
