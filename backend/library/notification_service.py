import asyncio
import json
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from core.model import notification as noti_model
from core.model import user as user_model
from core.model import push_subscription as push_sub_model
from library.ws_manager import manager
from config import VAPID_PRIVATE_KEY, VAPID_SUBJECT

logger = logging.getLogger(__name__)


async def _send_web_push(user_id: int, title: str, link: str, db: AsyncSession):
    """WebSocket 연결이 없는 사용자에게 Web Push 전송"""
    if not VAPID_PRIVATE_KEY:
        return

    subscriptions = await push_sub_model.find_by_user(user_id, db)
    if not subscriptions:
        return

    from pywebpush import webpush, WebPushException

    payload = json.dumps({
        'title': 'Weave',
        'body': title,
        'url': link or '/',
        'icon': '/icons/weave-192.png',
    })

    for sub in subscriptions:
        try:
            await asyncio.to_thread(
                webpush,
                subscription_info={
                    'endpoint': sub['endpoint'],
                    'keys': {'p256dh': sub['p256dh'], 'auth': sub['auth']},
                },
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={'sub': VAPID_SUBJECT},
            )
        except WebPushException as e:
            if e.response and e.response.status_code in (404, 410):
                # 구독 만료 -> 삭제
                await push_sub_model.delete_by_endpoint(sub['endpoint'], db)
            else:
                logger.warning(f"Web Push failed: {e}")
        except Exception as e:
            logger.warning(f"Web Push error: {e}")


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

    # WebSocket 연결 없음 -> Web Push 전송
    if user_id not in manager.active_connections:
        try:
            await _send_web_push(user_id, title, link, db)
        except Exception as e:
            logger.warning(f"Web Push fallback failed: {e}")


async def notify_bulk(user_ids: list[int], ntype: str, actor_id: int, title: str,
                      link: str, entity_type: str, entity_id: int, db: AsyncSession):
    """여러 수신자에게 일괄 알림 (actor 제외, 중복 제거)"""
    for uid in set(user_ids):
        await notify(uid, ntype, actor_id, title, link, entity_type, entity_id, db)
