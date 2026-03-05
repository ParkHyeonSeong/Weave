import os
import uuid

import bcrypt
from fastapi import Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import user as user_model
from core.controller.auth import _create_token

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'uploads', 'avatars')
ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
MAX_FILE_SIZE = 2 * 1024 * 1024  # 2MB


async def get_profile(request: Request, db: AsyncSession):
    """내 프로필 조회"""
    user_id = request.state.payload.get('user_id')
    user = await user_model.find_by_id(user_id, db)
    if not user:
        return {'status': False, 'message': 'USER_NOT_FOUND'}
    return {'status': True, 'user': user}


async def update_username(body, request: Request, db: AsyncSession):
    """사용자 이름 변경 + 토큰 재발급"""
    user_id = request.state.payload.get('user_id')
    user = await user_model.find_by_id(user_id, db)
    if not user:
        return {'status': False, 'message': 'USER_NOT_FOUND'}

    await user_model.update_username(user_id, body.username, db)
    # JWT 재발급 (username이 payload에 포함되므로)
    token = _create_token(user_id, user['email'], body.username, user['role'])
    return {'status': True, 'x_token': token}


async def update_password(body, request: Request, db: AsyncSession):
    """비밀번호 변경"""
    user_id = request.state.payload.get('user_id')
    user = await user_model.find_by_id_with_password(user_id, db)
    if not user:
        return {'status': False, 'message': 'USER_NOT_FOUND'}

    # 현재 비밀번호 검증
    stored_password = user['password']
    if isinstance(stored_password, memoryview):
        stored_password = bytes(stored_password)
    if not bcrypt.checkpw(body.current_password.encode('utf-8'), stored_password):
        return {'status': False, 'message': 'INVALID_CURRENT_PASSWORD'}

    # 새 비밀번호 확인 일치 검증
    if body.new_password != body.confirm_password:
        return {'status': False, 'message': 'PASSWORD_MISMATCH'}

    new_hash = bcrypt.hashpw(body.new_password.encode('utf-8'), bcrypt.gensalt())
    await user_model.update_password(user_id, new_hash, db)
    return {'status': True}


async def upload_avatar(file: UploadFile, request: Request, db: AsyncSession):
    """아바타 이미지 업로드"""
    user_id = request.state.payload.get('user_id')
    user = await user_model.find_by_id(user_id, db)
    if not user:
        return {'status': False, 'message': 'USER_NOT_FOUND'}

    # 파일 검증
    if not file or not file.filename:
        return {'status': False, 'message': 'NO_FILE'}

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return {'status': False, 'message': 'INVALID_FILE_TYPE'}

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        return {'status': False, 'message': 'FILE_TOO_LARGE'}

    # 업로드 디렉토리 생성
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    # 기존 아바타 삭제
    if user.get('avatar_url'):
        old_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            user['avatar_url'].lstrip('/')
        )
        if os.path.exists(old_path):
            os.remove(old_path)

    # 고유 파일명 생성 및 저장
    filename = f"{user_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, 'wb') as f:
        f.write(content)

    avatar_url = f"/uploads/avatars/{filename}"
    await user_model.update_avatar(user_id, avatar_url, db)

    return {'status': True, 'avatar_url': avatar_url}
