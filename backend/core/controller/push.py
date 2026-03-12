from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import push_subscription as push_sub_model
from config import VAPID_PUBLIC_KEY


async def get_vapid_key():
    """VAPID 공개키 반환"""
    return {'status': True, 'vapid_key': VAPID_PUBLIC_KEY}


async def subscribe(body, request: Request, db: AsyncSession):
    """Push 구독 저장"""
    user_id = request.state.payload['user_id']
    await push_sub_model.upsert(user_id, body.endpoint, body.p256dh, body.auth, db)
    return {'status': True}


async def unsubscribe(body, request: Request, db: AsyncSession):
    """Push 구독 해제"""
    await push_sub_model.delete_by_endpoint(body.endpoint, db)
    return {'status': True}
