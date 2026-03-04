from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import chat_room as room_model
from core.model import chat_member as member_model
from core.model import chat_message as message_model
from core.model import user as user_model


async def create_room(body, request: Request, db: AsyncSession):
    """채팅방 생성"""
    user_id = request.state.payload.get('user_id')

    # DM: 기존 방이 있으면 그것을 반환
    if body.room_type == 'dm':
        if len(body.member_ids) != 1:
            return {'status': False, 'message': 'DM_REQUIRES_ONE_MEMBER'}
        target_id = body.member_ids[0]
        existing = await room_model.find_dm_room(user_id, target_id, db)
        if existing:
            return {'status': True, 'room_id': existing, 'is_existing': True}

    # 채팅방 생성
    room_id = await room_model.create(
        room_type=body.room_type,
        room_name=body.room_name,
        created_by=user_id,
        db=db,
    )

    # 생성자 자신을 멤버로 추가
    await member_model.add(room_id, user_id, db)

    # 추가 멤버들 등록
    for mid in body.member_ids:
        if mid != user_id:
            await member_model.add(room_id, mid, db)

    return {'status': True, 'room_id': room_id}


async def get_rooms(request: Request, db: AsyncSession):
    """내 채팅방 목록"""
    user_id = request.state.payload.get('user_id')
    rooms = await room_model.find_rooms_by_user(user_id, db)
    return {'status': True, 'rooms': rooms}


async def get_messages(room_id: int, request: Request, db: AsyncSession,
                       limit: int = 50, offset: int = 0):
    """채팅방 메시지 목록"""
    user_id = request.state.payload.get('user_id')

    # 멤버 확인
    if not await member_model.is_member(room_id, user_id, db):
        return {'status': False, 'message': 'NOT_A_MEMBER'}

    messages = await message_model.find_by_room(room_id, limit, offset, db)

    # 읽음 시간 갱신
    await member_model.update_last_read(room_id, user_id, db)

    return {'status': True, 'messages': messages}


async def get_users(db: AsyncSession):
    """전체 사용자 목록"""
    users = await user_model.find_all(db)
    return {'status': True, 'users': users}
