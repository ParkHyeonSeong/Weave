from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import track as track_model
from core.model import track_member as member_model
from core.model import track_branch as track_branch_model
from core.model import track_item as track_item_model
from core.model import branch_member as branch_member_model
from core.model import branch as branch_model
from core.model import task as task_model


# =========================================================================
# Helpers
# =========================================================================

async def _require_role(track_id: int, request: Request, required: str,
                         db: AsyncSession):
    """Track 존재 + 사용자 role 검증.
    OK이면 None, 아니면 error dict 반환 (caller는 그대로 return).
    required: 'viewer' | 'editor' | 'owner'
    """
    if not await track_model.find_by_id(track_id, db):
        return {'status': False, 'message': 'TRACK_NOT_FOUND'}
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(track_id, user_id, db)
    if not member_model.has_at_least(role, required):
        return {'status': False, 'message': 'PERMISSION_DENIED'}
    return None


# =========================================================================
# Track CRUD
# =========================================================================

async def create(body, request: Request, db: AsyncSession):
    """Track 생성 + 생성자를 owner로 + participating branches 동시 설정"""
    user_id = request.state.payload.get('user_id')

    track_id = await track_model.create(
        track_name=body.track_name,
        description=body.description or '',
        color=body.color or '#5E6AD2',
        icon=body.icon,
        visibility=body.visibility or 'private',
        default_view=body.default_view or 'flow',
        created_by=user_id,
        db=db,
    )

    # 생성자 owner 자동 추가
    await member_model.add(track_id, user_id, 'owner', db)

    # 참여 branch 설정 — 사용자가 멤버인 branch만 허용 (배치 검증)
    requested_ids = body.participating_branch_ids or []
    if requested_ids:
        allowed_ids = await branch_member_model.filter_member_branch_ids(
            user_id, requested_ids, db)
        for branch_id in allowed_ids:
            await track_branch_model.add(track_id, branch_id, db)

    return {'status': True, 'track_id': track_id}


async def get_list(request: Request, db: AsyncSession):
    """내가 멤버인 Track 목록"""
    user_id = request.state.payload.get('user_id')
    tracks = await track_model.find_accessible(user_id, db)
    return {'status': True, 'tracks': tracks}


async def get_detail(track_id: int, request: Request, db: AsyncSession):
    """Track 상세 + 내 role + 참여 branches"""
    track = await track_model.find_by_id(track_id, db)
    if not track:
        return {'status': False, 'message': 'TRACK_NOT_FOUND'}

    user_id = request.state.payload.get('user_id')
    my_role = await member_model.get_role(track_id, user_id, db)

    # private: 멤버만 / public: 누구나 조회 가능
    if track['visibility'] == 'private' and not my_role:
        return {'status': False, 'message': 'ACCESS_DENIED'}

    track['my_role'] = my_role
    track['participating_branches'] = await track_branch_model.find_by_track(track_id, db)
    return {'status': True, 'track': track}


async def update(track_id: int, body, request: Request, db: AsyncSession):
    """Track 정보 수정 — editor 이상"""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {'status': True}
    await track_model.update(track_id, fields, db)
    return {'status': True}


async def archive(track_id: int, request: Request, db: AsyncSession):
    """Track 아카이브 — owner만"""
    err = await _require_role(track_id, request, 'owner', db)
    if err:
        return err
    await track_model.archive(track_id, db)
    return {'status': True}


# =========================================================================
# Members
# =========================================================================

async def get_members(track_id: int, request: Request, db: AsyncSession):
    """Track 멤버 목록 — 본인 멤버이거나 public Track"""
    track = await track_model.find_by_id(track_id, db)
    if not track:
        return {'status': False, 'message': 'TRACK_NOT_FOUND'}

    user_id = request.state.payload.get('user_id')
    if track['visibility'] == 'private':
        if not await member_model.is_member(track_id, user_id, db):
            return {'status': False, 'message': 'ACCESS_DENIED'}

    members = await member_model.find_by_track(track_id, db)
    return {'status': True, 'members': members}


async def add_member(track_id: int, body, request: Request, db: AsyncSession):
    """멤버 초대 — owner만 (role은 pydantic schema에서 이미 validated)"""
    err = await _require_role(track_id, request, 'owner', db)
    if err:
        return err
    await member_model.add(track_id, body.user_id, body.role, db)
    return {'status': True}


async def update_member_role(track_id: int, target_user_id: int, body,
                              request: Request, db: AsyncSession):
    """멤버 role 변경 — owner만 + 마지막 owner 강등 방지"""
    err = await _require_role(track_id, request, 'owner', db)
    if err:
        return err

    target_role = await member_model.get_role(track_id, target_user_id, db)
    if not target_role:
        return {'status': False, 'message': 'MEMBER_NOT_FOUND'}

    new_role = body.role  # schema에서 validated
    if target_role == 'owner' and new_role != 'owner':
        owner_count = await member_model.count_owners(track_id, db)
        if owner_count <= 1:
            return {'status': False, 'message': 'LAST_OWNER'}

    await member_model.update_role(track_id, target_user_id, new_role, db)
    return {'status': True}


async def remove_member(track_id: int, target_user_id: int, request: Request,
                        db: AsyncSession):
    """멤버 제거 — owner이거나 본인(leave)"""
    if not await track_model.find_by_id(track_id, db):
        return {'status': False, 'message': 'TRACK_NOT_FOUND'}

    user_id = request.state.payload.get('user_id')
    is_self = (target_user_id == user_id)
    if not is_self:
        role = await member_model.get_role(track_id, user_id, db)
        if role != 'owner':
            return {'status': False, 'message': 'PERMISSION_DENIED'}

    target_role = await member_model.get_role(track_id, target_user_id, db)
    if not target_role:
        return {'status': True}  # idempotent

    if target_role == 'owner':
        owner_count = await member_model.count_owners(track_id, db)
        if owner_count <= 1:
            return {'status': False, 'message': 'LAST_OWNER'}

    await member_model.remove(track_id, target_user_id, db)
    return {'status': True}


# =========================================================================
# Participating branches
# =========================================================================

async def get_branches(track_id: int, request: Request, db: AsyncSession):
    """Track의 참여 branch 목록 — 멤버만"""
    user_id = request.state.payload.get('user_id')
    if not await _can_view(track_id, user_id, db):
        return {'status': False, 'message': 'ACCESS_DENIED'}
    branches = await track_branch_model.find_by_track(track_id, db)
    return {'status': True, 'branches': branches}


async def add_branch(track_id: int, body, request: Request, db: AsyncSession):
    """참여 branch 추가 — editor 이상 + 본인이 그 branch 멤버여야 함"""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err

    user_id = request.state.payload.get('user_id')
    if not await branch_member_model.is_member(body.branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}
    if not await branch_model.find_by_id(body.branch_id, db):
        return {'status': False, 'message': 'BRANCH_NOT_FOUND'}

    await track_branch_model.add(track_id, body.branch_id, db)
    return {'status': True}


async def remove_branch(track_id: int, branch_id: int, request: Request,
                        db: AsyncSession):
    """참여 branch 제거 — editor 이상"""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err
    await track_branch_model.remove(track_id, branch_id, db)
    return {'status': True}


async def update_branch_override(track_id: int, branch_id: int, body,
                                  request: Request, db: AsyncSession):
    """Track-local branch override (display_name, color) — editor 이상"""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {'status': True}
    await track_branch_model.update_override(track_id, branch_id, fields, db)
    return {'status': True}


# =========================================================================
# Helpers
# =========================================================================

async def _can_view(track_id: int, user_id: int, db: AsyncSession) -> bool:
    """Track 조회 권한 — 멤버이거나 public Track"""
    track = await track_model.find_by_id(track_id, db)
    if not track:
        return False
    if track['visibility'] == 'public':
        return True
    return await member_model.is_member(track_id, user_id, db)


# =========================================================================
# Items (Track 내 task 참조)
# =========================================================================

async def get_items(track_id: int, request: Request, db: AsyncSession):
    """Track의 모든 item — viewer 이상 (private은 멤버만, public은 모두)"""
    user_id = request.state.payload.get('user_id')
    if not await _can_view(track_id, user_id, db):
        return {'status': False, 'message': 'ACCESS_DENIED'}
    items = await track_item_model.find_by_track(track_id, user_id, db)
    return {'status': True, 'items': items}


async def add_item(track_id: int, body, request: Request, db: AsyncSession):
    """Task를 Track에 참조로 추가 — editor 이상 + source task의 branch 멤버여야 함.
    Track의 participating에 없는 branch면 자동으로 추가.
    """
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err

    user_id = request.state.payload.get('user_id')

    # source task 존재 + 사용자가 그 branch 멤버인지
    task = await task_model.find_by_id(body.source_task_id, db)
    if not task:
        return {'status': False, 'message': 'TASK_NOT_FOUND'}

    if not await branch_member_model.is_member(task['branch_id'], user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    # task의 branch가 Track의 participating에 없으면 자동 추가
    if not await track_branch_model.is_participating(track_id, task['branch_id'], db):
        await track_branch_model.add(track_id, task['branch_id'], db)

    item_id = await track_item_model.create_task_ref(
        track_id, body.source_task_id,
        body.position_x or 0, body.position_y or 0,
        db,
    )
    return {'status': True, 'item_id': item_id}


async def update_item_positions(track_id: int, body, request: Request,
                                 db: AsyncSession):
    """Item 위치 bulk 업데이트 (debounced) — editor 이상"""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err
    positions = [p.model_dump() for p in body.positions]
    await track_item_model.update_positions(track_id, positions, db)
    return {'status': True}


async def delete_item(track_id: int, item_id: int, request: Request,
                      db: AsyncSession):
    """Item 삭제 — editor 이상"""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err
    await track_item_model.delete(item_id, track_id, db)
    return {'status': True}


# =========================================================================
# Sources (SourcePicker용 검색)
# =========================================================================

async def search_sources(track_id: int, request: Request, db: AsyncSession):
    """Track의 participating branches에서 task 검색 — viewer 이상.
    응답에는 사용자가 멤버인 branch의 task만 포함.
    """
    user_id = request.state.payload.get('user_id')
    if not await _can_view(track_id, user_id, db):
        return {'status': False, 'message': 'ACCESS_DENIED'}

    qp = request.query_params
    q = qp.get('q', '')
    raw_branch = qp.get('branch_id')
    branch_id = int(raw_branch) if raw_branch and raw_branch.isdigit() else None
    raw_limit = qp.get('limit', '50')
    limit = int(raw_limit) if raw_limit.isdigit() else 50
    limit = max(1, min(limit, 200))

    tasks = await track_item_model.search_sources(
        track_id, user_id, q, branch_id, limit, db)
    return {'status': True, 'tasks': tasks}
