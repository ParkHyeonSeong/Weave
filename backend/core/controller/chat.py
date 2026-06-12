from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import chat_room as room_model
from core.model import chat_member as member_model
from core.model import chat_message as message_model
from core.model import user as user_model
from core.model import task as task_model
from core.model import canvas_page as canvas_page_model
from core.model import task_issue as issue_model


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

    # 방 정보 + 멤버 목록 (읽음 처리용)
    room = await room_model.find_by_id(room_id, db)
    members = await member_model.find_by_room(room_id, db)

    # 본인의 last_read_at 추출 (읽음 갱신 전)
    my_last_read_at = None
    others = []
    for m in members:
        if m['user_id'] == user_id:
            my_last_read_at = m.get('last_read_at')
        else:
            others.append({'user_id': m['user_id'], 'username': m['username'], 'last_read_at': m.get('last_read_at')})

    messages = await message_model.find_by_room(room_id, limit, offset, db)

    # 읽음 시간 갱신
    await member_model.update_last_read(room_id, user_id, db)

    return {
        'status': True,
        'messages': messages,
        'room_type': room['room_type'] if room else None,
        'room_name': room['room_name'] if room else None,
        'members': others,
        'my_last_read_at': str(my_last_read_at) if my_last_read_at else None,
    }


async def rename_room(room_id: int, body, request: Request, db: AsyncSession):
    """채팅방 이름 변경"""
    user_id = request.state.payload.get('user_id')

    # 멤버 확인
    if not await member_model.is_member(room_id, user_id, db):
        return {'status': False, 'message': 'NOT_A_MEMBER'}

    await room_model.update_room_name(room_id, body.room_name, db)
    return {'status': True, 'room_name': body.room_name}


async def search_tasks(keyword: str, mode: str, request: Request, db: AsyncSession):
    """채팅용 Task 검색"""
    user_id = request.state.payload.get('user_id')
    my_only = mode == 'my'
    tasks = await task_model.search_for_chat(user_id, keyword, my_only, db)
    return {'status': True, 'tasks': tasks}


async def search_docs(keyword: str, request: Request, db: AsyncSession):
    """채팅용 Canvas 문서 검색"""
    user_id = request.state.payload.get('user_id')
    docs = await canvas_page_model.search_for_chat(user_id, keyword, db)
    return {'status': True, 'docs': docs}


async def search_issues(keyword: str, request: Request, db: AsyncSession):
    """채팅용 Issue 검색"""
    user_id = request.state.payload.get('user_id')
    issues = await issue_model.search_for_chat(user_id, keyword, db)
    return {'status': True, 'issues': issues}


def _strip_email(users):
    """멘션/디렉터리 응답에서 email을 제거한다 — 이름·아바타면 충분하고, 이메일을
    모든 인증 사용자에게 넓게 노출하지 않기 위함(SEC-09/SEC-21)."""
    return [{k: v for k, v in u.items() if k != 'email'} for u in users]


async def get_users(db: AsyncSession):
    """전체 사용자 목록 (메신저 디렉터리 — 이메일 제외)"""
    users = await user_model.find_all(db)
    return {'status': True, 'users': _strip_email(users)}


async def search_mentions(query: str, request: Request, db: AsyncSession,
                           room_id: int = None, branch_id: int = None, canvas_id: int = None):
    """@멘션 사용자 검색. 호출자가 멤버인 방/브랜치/캔버스 범위로만 검색한다.

    유효 범위가 없거나 호출자가 그 범위의 멤버가 아니면 빈 결과를 반환한다 —
    범위 없는 전체 활성 사용자 열거를 막는다(SEC-09). 응답에서 이메일은 제거한다.
    """
    user_id = request.state.payload.get('user_id')

    if room_id:
        from core.model import chat_member as chat_member_model
        if not await chat_member_model.is_member(room_id, user_id, db):
            return {'status': True, 'users': []}
        users = await chat_member_model.search_room_members(room_id, query, user_id, 10, db)
    elif branch_id:
        from core.model import branch_member as branch_member_model
        if not await branch_member_model.is_member(branch_id, user_id, db):
            return {'status': True, 'users': []}
        users = await branch_member_model.search_members(branch_id, query, user_id, 10, db)
    elif canvas_id:
        from core.model import canvas_member as canvas_member_model
        if not await canvas_member_model.is_member(canvas_id, user_id, db):
            return {'status': True, 'users': []}
        users = await canvas_member_model.search_members(canvas_id, query, user_id, 10, db)
    else:
        users = []

    return {'status': True, 'users': _strip_email(users)}
