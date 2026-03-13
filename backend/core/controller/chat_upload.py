import os
import uuid
import mimetypes

from fastapi import Request, UploadFile

from library.file_validator import validate_image_magic_bytes

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'uploads', 'chat')

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
FILE_EXTENSIONS = {'.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.zip'}
ALLOWED_EXTENSIONS = IMAGE_EXTENSIONS | FILE_EXTENSIONS

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


async def upload(file: UploadFile, request: Request):
    """채팅 파일 업로드"""
    if not file or not file.filename:
        return {'status': False, 'message': 'NO_FILE'}

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return {'status': False, 'message': 'INVALID_FILE_TYPE'}

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        return {'status': False, 'message': 'FILE_TOO_LARGE'}

    # 이미지는 매직 바이트 검증
    if ext in IMAGE_EXTENSIONS:
        if not validate_image_magic_bytes(content, ext):
            return {'status': False, 'message': 'INVALID_FILE_CONTENT'}

    # 디렉토리 생성
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    # 고유 파일명
    filename = f"chat_{uuid.uuid4().hex[:12]}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, 'wb') as f:
        f.write(content)

    file_url = f"/api/uploads/chat/{filename}"
    file_type = mimetypes.guess_type(file.filename)[0] or 'application/octet-stream'

    return {
        'status': True,
        'url': file_url,
        'file_name': file.filename,
        'file_type': file_type,
        'file_size': len(content),
    }
