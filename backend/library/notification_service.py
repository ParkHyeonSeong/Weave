from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from core.model import notification as noti_model
from core.model import user as user_model
from library.ws_manager import manager


async def notify(user_id: int, ntype: str, actor_id: int, title: str,
                 link: str, entity_type: str, entity_id: int, db: AsyncSession):
    """DB 저장 + WebSocket 실시간 푸시 (본인에게는 알림하지 않음)"""
    if user_id == actor_id:
        return

    noti_id = await noti_model.create(user_id, ntype, actor_id, title, link, entity_type, entity_id, db)
    unread = await noti_model.count_unread(user_id, db)

    # actor_name 조회
    actor_name = None
    if actor_id:
        actor = await user_model.find_by_id(actor_id, db)
        if actor:
            actor_name = actor['username']

    await manager.send_to_user(user_id, {
        'type': 'notification',
        'notification': {
            'notification_id': noti_id,
            'type': ntype,
            'actor_id': actor_id,
            'actor_name': actor_name,
            'title': title,
            'link': link,
            'entity_type': entity_type,
            'entity_id': entity_id,
            'is_read': False,
            'created_at': str(datetime.now(timezone.utc)),
        },
        'unread_count': unread,
    })


async def notify_bulk(user_ids: list[int], ntype: str, actor_id: int, title: str,
                      link: str, entity_type: str, entity_id: int, db: AsyncSession):
    """여러 수신자에게 일괄 알림 (actor 제외, 중복 제거)"""
    for uid in set(user_ids):
        await notify(uid, ntype, actor_id, title, link, entity_type, entity_id, db)
