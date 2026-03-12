from pydantic import BaseModel


class SubscribeBody(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


class UnsubscribeBody(BaseModel):
    endpoint: str
