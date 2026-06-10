import os
import uuid

from fastapi import Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import branch_member as branch_member_model
from core.model import canvas as canvas_model
from core.model import canvas_member as member_model
from core.model import canvas_page as page_model
from library.file_validator import validate_image_magic_bytes
from library.icon_storage import delete_image_icon_file
from library.svg_sanitizer import sanitize_svg

ICON_UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    'uploads', 'canvas-icons'
)
ICON_ALLOWED_EXT = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'}
ICON_MAX_SIZE = 2 * 1024 * 1024  # 2MB


async def create(body, request: Request, db: AsyncSession):
    """Canvas 생성"""
    user_id = request.state.payload.get('user_id')

    # branch에 붙이는 canvas면 그 branch 멤버인지 검증 (IDOR 방어).
    # branch_id는 nullable(독립 canvas 허용)이므로 None이면 검증 건너뜀.
    if body.branch_id is not None:
        if not await branch_member_model.is_member(body.branch_id, user_id, db):
            return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    # key 중복 체크
    if await canvas_model.find_by_key(body.key, db):
        return {'status': False, 'message': 'KEY_ALREADY_EXISTS'}

    canvas_id = await canvas_model.create(
        canvas_name=body.canvas_name,
        key=body.key,
        description=body.description or '',
        visibility=body.visibility,
        created_by=user_id,
        branch_id=body.branch_id,
        db=db,
    )

    # 생성자를 admin으로 자동 추가
    await member_model.add(canvas_id, user_id, 'admin', db)

    # 캔버스 소개 페이지 자동 생성
    await page_model.create(
        canvas_id=canvas_id,
        title=body.canvas_name,
        content=f'<h2>{body.canvas_name}</h2><p>{body.description or ""}</p>',
        parent_page_id=None,
        position=0,
        created_by=user_id,
        page_type='overview',
        db=db,
    )

    return {
        'status': True,
        'canvas_id': canvas_id,
        'key': body.key,
    }


async def get_list(request: Request, db: AsyncSession):
    """내가 접근 가능한 Canvas 목록"""
    user_id = request.state.payload.get('user_id')
    canvases = await canvas_model.find_accessible(user_id, db)
    return {'status': True, 'canvases': canvases}


async def get_home_stats(request: Request, db: AsyncSession):
    """홈 KPI 집계 (접근 가능한 모든 Canvas 기준)"""
    user_id = request.state.payload.get('user_id')
    stats = await canvas_model.home_stats(user_id, db)
    return {'status': True, **stats}


async def get_detail(canvas_id: int, request: Request, db: AsyncSession):
    """Canvas 상세 (현재 사용자의 role 포함)"""
    canvas = await canvas_model.find_by_id(canvas_id, db)
    if not canvas:
        return {'status': False, 'message': 'CANVAS_NOT_FOUND'}

    user_id = request.state.payload.get('user_id')
    my_role = await member_model.get_role(canvas_id, user_id, db)

    # private canvas는 멤버만 조회 가능
    if canvas['visibility'] == 'private' and not my_role:
        return {'status': False, 'message': 'ACCESS_DENIED'}

    canvas['my_role'] = my_role

    return {'status': True, 'canvas': canvas}


async def get_members(canvas_id: int, request: Request, db: AsyncSession):
    """Canvas 멤버 목록 (private canvas는 멤버만 조회 가능)"""
    canvas = await canvas_model.find_by_id(canvas_id, db)
    if not canvas:
        return {'status': False, 'message': 'CANVAS_NOT_FOUND'}

    user_id = request.state.payload.get('user_id')
    if canvas['visibility'] == 'private':
        if not await member_model.is_member(canvas_id, user_id, db):
            return {'status': False, 'message': 'ACCESS_DENIED'}

    members = await member_model.find_by_canvas(canvas_id, db)
    return {'status': True, 'members': members}


async def upload_icon(canvas_id: int, file: UploadFile, request: Request, db: AsyncSession):
    """Canvas 아이콘 이미지 업로드 (admin만). icon 컬럼에 'image:...' 형태로 저장."""
    user_id = request.state.payload.get('user_id')

    canvas = await canvas_model.find_by_id(canvas_id, db)
    if not canvas:
        return {'status': False, 'message': 'CANVAS_NOT_FOUND'}

    role = await member_model.get_role(canvas_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    if not file or not file.filename:
        return {'status': False, 'message': 'NO_FILE'}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ICON_ALLOWED_EXT:
        return {'status': False, 'message': 'INVALID_FILE_TYPE'}
    content = await file.read()
    if len(content) > ICON_MAX_SIZE:
        return {'status': False, 'message': 'FILE_TOO_LARGE'}
    if not validate_image_magic_bytes(content, ext):
        return {'status': False, 'message': 'INVALID_FILE_CONTENT'}

    if ext == '.svg':
        sanitized = sanitize_svg(content)
        if sanitized is None:
            return {'status': False, 'message': 'INVALID_FILE_CONTENT'}
        content = sanitized

    os.makedirs(ICON_UPLOAD_DIR, exist_ok=True)
    delete_image_icon_file(canvas.get('icon'), ICON_UPLOAD_DIR)

    filename = f"{canvas_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(ICON_UPLOAD_DIR, filename)
    with open(filepath, 'wb') as f:
        f.write(content)

    icon_value = f"image:/api/uploads/canvas-icons/{filename}"
    await canvas_model.update(canvas_id, {'icon': icon_value}, db)
    return {'status': True, 'icon': icon_value}


async def update(canvas_id: int, body, request: Request, db: AsyncSession):
    """Canvas 정보 수정 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(canvas_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {'status': True}

    # key 변경 시 중복 체크 + icon이 image:에서 떠나면 디스크 정리
    needs_current = 'key' in fields or 'icon' in fields
    current = await canvas_model.find_by_id(canvas_id, db) if needs_current else None

    if 'key' in fields and current and current['key'] != fields['key']:
        if await canvas_model.find_by_key(fields['key'], db):
            return {'status': False, 'message': 'KEY_ALREADY_EXISTS'}

    if 'icon' in fields and current:
        old_icon = current.get('icon') or ''
        if old_icon != (fields.get('icon') or ''):
            delete_image_icon_file(old_icon, ICON_UPLOAD_DIR)

    await canvas_model.update(canvas_id, fields, db)
    return {'status': True}


async def get_public_list(request: Request, db: AsyncSession):
    """Public canvas 목록 (내가 미가입)"""
    user_id = request.state.payload.get('user_id')
    query = request.query_params.get('q', '')
    canvases = await canvas_model.find_public(user_id, query, db)
    return {'status': True, 'canvases': canvases}


async def join(canvas_id: int, request: Request, db: AsyncSession):
    """Public canvas 가입"""
    user_id = request.state.payload.get('user_id')

    canvas = await canvas_model.find_by_id(canvas_id, db)
    if not canvas:
        return {'status': False, 'message': 'CANVAS_NOT_FOUND'}
    if canvas['visibility'] != 'public':
        return {'status': False, 'message': 'CANVAS_NOT_PUBLIC'}

    if await member_model.is_member(canvas_id, user_id, db):
        return {'status': False, 'message': 'ALREADY_MEMBER'}

    await member_model.add(canvas_id, user_id, 'member', db)
    return {'status': True}


async def add_member(canvas_id: int, body, request: Request, db: AsyncSession):
    """멤버 초대 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(canvas_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    if await member_model.is_member(canvas_id, body.user_id, db):
        return {'status': False, 'message': 'ALREADY_MEMBER'}

    await member_model.add(canvas_id, body.user_id, body.role, db)
    return {'status': True}


async def update_member_role(canvas_id: int, target_user_id: int, body, request: Request, db: AsyncSession):
    """멤버 역할 변경 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(canvas_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    if not await member_model.is_member(canvas_id, target_user_id, db):
        return {'status': False, 'message': 'NOT_CANVAS_MEMBER'}

    current_role = await member_model.get_role(canvas_id, target_user_id, db)
    if current_role == 'admin' and body.role != 'admin':
        admin_count = await member_model.count_admins(canvas_id, db)
        if admin_count <= 1:
            return {'status': False, 'message': 'CANNOT_REMOVE_LAST_ADMIN'}

    await member_model.update_role(canvas_id, target_user_id, body.role, db)
    return {'status': True}


async def remove_member(canvas_id: int, target_user_id: int, request: Request, db: AsyncSession):
    """멤버 제거 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(canvas_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    target_role = await member_model.get_role(canvas_id, target_user_id, db)
    if not target_role:
        return {'status': False, 'message': 'NOT_CANVAS_MEMBER'}

    if target_role == 'admin':
        admin_count = await member_model.count_admins(canvas_id, db)
        if admin_count <= 1:
            return {'status': False, 'message': 'CANNOT_REMOVE_LAST_ADMIN'}

    await member_model.remove(canvas_id, target_user_id, db)
    return {'status': True}


async def leave(canvas_id: int, request: Request, db: AsyncSession):
    """캔버스 나가기 (본인)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(canvas_id, user_id, db)
    if not role:
        return {'status': False, 'message': 'NOT_CANVAS_MEMBER'}

    if role == 'admin':
        admin_count = await member_model.count_admins(canvas_id, db)
        if admin_count <= 1:
            return {'status': False, 'message': 'CANNOT_LEAVE_LAST_ADMIN'}

    await member_model.remove(canvas_id, user_id, db)
    return {'status': True}


async def delete(canvas_id: int, request: Request, db: AsyncSession):
    """Canvas 삭제/아카이브 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(canvas_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    canvas = await canvas_model.find_by_id(canvas_id, db)
    if not canvas:
        return {'status': False, 'message': 'CANVAS_NOT_FOUND'}

    await canvas_model.archive(canvas_id, db)
    return {'status': True}


async def list_archived(request: Request, db: AsyncSession):
    """아카이브된 Canvas 목록 (admin인 것만, 보관함용)."""
    user_id = request.state.payload.get('user_id')
    canvases = await canvas_model.find_archived(user_id, db)
    return {'status': True, 'canvases': canvases}


async def restore(canvas_id: int, request: Request, db: AsyncSession):
    """Canvas 복원 (admin만). 아카이브된 canvas도 멤버십은 살아있어 role로 확인."""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(canvas_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}
    await canvas_model.restore(canvas_id, db)
    return {'status': True}


async def permanent_delete(canvas_id: int, request: Request, db: AsyncSession):
    """Canvas 영구삭제 (admin만, CASCADE)."""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(canvas_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}
    await canvas_model.hard_delete(canvas_id, db)
    return {'status': True}


async def search_non_members(canvas_id: int, query: str, request: Request, db: AsyncSession):
    """초대 가능한 사용자 검색"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(canvas_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    users = await member_model.search_non_members(canvas_id, query, db)
    return {'status': True, 'users': users}
