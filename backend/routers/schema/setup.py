from pydantic import BaseModel, field_validator


class SetupInitialize(BaseModel):
    workspace_name: str
    registration_policy: str
    email: str
    password: str
    username: str

    @field_validator('registration_policy')
    @classmethod
    def validate_policy(cls, v):
        if v not in ('public', 'private'):
            raise ValueError('registration_policy must be "public" or "private"')
        return v
