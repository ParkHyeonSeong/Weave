from pydantic import BaseModel, field_validator


class URLMetaRequest(BaseModel):
    url: str

    @field_validator('url')
    @classmethod
    def validate_url(cls, v):
        v = v.strip()
        if not v.startswith('http://') and not v.startswith('https://'):
            raise ValueError('URL must start with http:// or https://')
        return v
