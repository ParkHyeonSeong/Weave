from pydantic import BaseModel, field_validator

from library.crypto import MIN_PASSWORD_LENGTH


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

    @field_validator('password')
    @classmethod
    def validate_password(cls, v):
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f'password must be at least {MIN_PASSWORD_LENGTH} characters')
        return v
