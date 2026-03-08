from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import notification as noti_model


async def get_list(limit: int, offset: int, request: Request, db: AsyncSession):
    """알림 목록"""
    user_id = request.state.payload.get('user_id')
    notifications = await noti_model.find_by_user(user_id, limit, offset, db)
    return {'status': True, 'notifications': notifications}


async def get_unread_count(request: Request, db: AsyncSession):
    """읽지 않은 알림 수"""
    user_id = request.state.payload.get('user_id')
    count = await noti_model.count_unread(user_id, db)
    return {'status': True, 'count': count}


async def mark_read(notification_id: int, request: Request, db: AsyncSession):
    """단일 알림 읽음"""
    user_id = request.state.payload.get('user_id')
    await noti_model.mark_read(notification_id, user_id, db)
    return {'status': True}


async def mark_all_read(request: Request, db: AsyncSession):
    """전체 읽음"""
    user_id = request.state.payload.get('user_id')
    await noti_model.mark_all_read(user_id, db)
    return {'status': True}


async def delete_all(request: Request, db: AsyncSession):
    """전체 삭제"""
    user_id = request.state.payload.get('user_id')
    await noti_model.delete_all(user_id, db)
    return {'status': True}
