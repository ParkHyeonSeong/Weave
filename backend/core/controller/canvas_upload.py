import os
import uuid

from fastapi import Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import canvas_member as member_model
from library.file_validator import validate_image_magic_bytes

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'uploads', 'canvas')
ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


async def upload_image(canvas_id: int, file: UploadFile, request: Request, db: AsyncSession):
    """Canvas 이미지 업로드"""
    user_id = request.state.payload.get('user_id')

    # 멤버 확인
    if not await member_model.is_member(canvas_id, user_id, db):
        return {'status': False, 'message': 'NOT_CANVAS_MEMBER'}

    # 파일 검증
    if not file or not file.filename:
        return {'status': False, 'message': 'NO_FILE'}

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return {'status': False, 'message': 'INVALID_FILE_TYPE'}

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        return {'status': False, 'message': 'FILE_TOO_LARGE'}

    # 매직 바이트 검증
    if not validate_image_magic_bytes(content, ext):
        return {'status': False, 'message': 'INVALID_FILE_CONTENT'}

    # 디렉토리 생성
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    # 고유 파일명
    filename = f"c{canvas_id}_{uuid.uuid4().hex[:12]}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, 'wb') as f:
        f.write(content)

    image_url = f"/api/uploads/canvas/{filename}"
    return {'status': True, 'url': image_url}
