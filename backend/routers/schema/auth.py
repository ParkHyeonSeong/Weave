from pydantic import BaseModel


class UserLogin(BaseModel):
    email: str
    password: str


class UserRegister(BaseModel):
    email: str
    password: str
    username: str


class ResetPassword(BaseModel):
    token: str
    new_password: str
