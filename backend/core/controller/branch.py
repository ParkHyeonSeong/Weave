from fastapi import Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import branch as branch_model
from core.model import branch_member as member_model
from core.model import task_type_config as type_model
from core.model import workflow_status as ws_model


async def create(body, request: Request, db: AsyncSession):
    """Branch 생성"""
    user_id = request.state.payload.get('user_id')

    # key 중복 체크
    if await branch_model.find_by_key(body.key, db):
        return {'status': False, 'message': 'KEY_ALREADY_EXISTS'}

    branch_id = await branch_model.create(
        branch_name=body.branch_name,
        key=body.key,
        description=body.description or '',
        visibility=body.visibility,
        created_by=user_id,
        db=db,
    )

    # 생성자를 admin으로 자동 추가
    await member_model.add(branch_id, user_id, 'admin', db)

    # task_sequence 초기화
    await db.execute(text("""
        INSERT INTO task_sequence (branch_id, last_number) VALUES (:branch_id, 0)
    """), {'branch_id': branch_id})
    await db.commit()

    # 기본 task type 시딩
    await type_model.seed_defaults(branch_id, db)

    # 기본 workflow status 시딩
    await ws_model.seed_defaults(branch_id, db)

    return {
        'status': True,
        'branch_id': branch_id,
        'key': body.key,
    }


async def get_list(request: Request, db: AsyncSession):
    """내가 접근 가능한 Branch 목록"""
    user_id = request.state.payload.get('user_id')
    branches = await branch_model.find_accessible(user_id, db)
    return {'status': True, 'branches': branches}


async def get_detail(branch_id: int, request: Request, db: AsyncSession):
    """Branch 상세 (현재 사용자의 role 포함)"""
    branch = await branch_model.find_by_id(branch_id, db)
    if not branch:
        return {'status': False, 'message': 'BRANCH_NOT_FOUND'}

    user_id = request.state.payload.get('user_id')
    my_role = await member_model.get_role(branch_id, user_id, db)
    branch['my_role'] = my_role

    return {'status': True, 'branch': branch}


async def update(branch_id: int, body, request: Request, db: AsyncSession):
    """Branch 정보 수정 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {'status': True}

    # key 변경 시 중복 체크
    if 'key' in fields:
        branch = await branch_model.find_by_id(branch_id, db)
        if branch and branch['key'] != fields['key']:
            if await branch_model.find_by_key(fields['key'], db):
                return {'status': False, 'message': 'KEY_ALREADY_EXISTS'}

    await branch_model.update(branch_id, fields, db)
    return {'status': True}


async def get_public_list(request: Request, db: AsyncSession):
    """Public branch 목록 (내가 미가입)"""
    user_id = request.state.payload.get('user_id')
    query = request.query_params.get('q', '')
    branches = await branch_model.find_public(user_id, query, db)
    return {'status': True, 'branches': branches}


async def join(branch_id: int, request: Request, db: AsyncSession):
    """Public branch 가입"""
    user_id = request.state.payload.get('user_id')

    branch = await branch_model.find_by_id(branch_id, db)
    if not branch:
        return {'status': False, 'message': 'BRANCH_NOT_FOUND'}
    if branch['visibility'] != 'public':
        return {'status': False, 'message': 'BRANCH_NOT_PUBLIC'}

    # 이미 멤버인지 확인
    if await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'ALREADY_MEMBER'}

    await member_model.add(branch_id, user_id, 'member', db)
    return {'status': True}


async def add_member(branch_id: int, body, request: Request, db: AsyncSession):
    """멤버 초대 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    # 이미 멤버인지 확인
    if await member_model.is_member(branch_id, body.user_id, db):
        return {'status': False, 'message': 'ALREADY_MEMBER'}

    await member_model.add(branch_id, body.user_id, body.role, db)
    return {'status': True}


async def update_member_role(branch_id: int, target_user_id: int, body, request: Request, db: AsyncSession):
    """멤버 역할 변경 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    # 대상이 멤버인지 확인
    if not await member_model.is_member(branch_id, target_user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    # admin → member 변경 시 마지막 admin인지 확인
    current_role = await member_model.get_role(branch_id, target_user_id, db)
    if current_role == 'admin' and body.role != 'admin':
        admin_count = await member_model.count_admins(branch_id, db)
        if admin_count <= 1:
            return {'status': False, 'message': 'CANNOT_REMOVE_LAST_ADMIN'}

    await member_model.update_role(branch_id, target_user_id, body.role, db)
    return {'status': True}


async def remove_member(branch_id: int, target_user_id: int, request: Request, db: AsyncSession):
    """멤버 제거 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    # 마지막 admin 제거 방지
    target_role = await member_model.get_role(branch_id, target_user_id, db)
    if not target_role:
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    if target_role == 'admin':
        admin_count = await member_model.count_admins(branch_id, db)
        if admin_count <= 1:
            return {'status': False, 'message': 'CANNOT_REMOVE_LAST_ADMIN'}

    await member_model.remove(branch_id, target_user_id, db)
    return {'status': True}


async def leave(branch_id: int, request: Request, db: AsyncSession):
    """브랜치 나가기 (본인)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if not role:
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    # 마지막 admin이면 나갈 수 없음
    if role == 'admin':
        admin_count = await member_model.count_admins(branch_id, db)
        if admin_count <= 1:
            return {'status': False, 'message': 'CANNOT_LEAVE_LAST_ADMIN'}

    await member_model.remove(branch_id, user_id, db)
    return {'status': True}


async def delete(branch_id: int, request: Request, db: AsyncSession):
    """Branch 삭제/아카이브 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    branch = await branch_model.find_by_id(branch_id, db)
    if not branch:
        return {'status': False, 'message': 'BRANCH_NOT_FOUND'}

    await branch_model.archive(branch_id, db)
    return {'status': True}


async def search_non_members(branch_id: int, query: str, request: Request, db: AsyncSession):
    """초대 가능한 사용자 검색"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    users = await member_model.search_non_members(branch_id, query, db)
    return {'status': True, 'users': users}
