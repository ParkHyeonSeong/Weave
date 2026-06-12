"""업로드 파일 서빙 — 인증 + 리소스 멤버십 검증(SEC-19).

기존엔 StaticFiles 마운트로 /api/uploads/* 를 인가 없이 서빙해, 파일명에 박힌
branch/canvas id만 알면 비멤버도 비공개 리소스의 첨부/이미지를 받을 수 있었다.
이제 task/canvas/chat 파일은 파일명에서 리소스 id를 파싱해 멤버십을 검증한다.
"""
import os
import re

from fastapi import APIRouter, Request, Depends
from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from library.validator import require_login
from core.model import branch_member, canvas_member, chat_member
import db_engine as db

router = APIRouter()

UPLOADS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'uploads')

# 인증만으로 접근 허용 — 헤더/목록/브라우즈에 널리 노출되는 준공개 자산
_PUBLIC_SUBDIRS = {'avatars', 'branch-icons', 'canvas-icons', 'track-icons'}
_SAFE_NAME = re.compile(r'^[A-Za-z0-9._-]+$')  # 경로 구분자·.. 차단


async def _is_authorized(subdir: str, filename: str, user_id: int, session: AsyncSession) -> bool:
    """task/canvas/chat 파일은 파일명에 박힌 리소스 id로 멤버십을 검증한다."""
    if subdir in _PUBLIC_SUBDIRS:
        return True
    if subdir == 'task':
        match = re.match(r'^t(\d+)_', filename)
        return bool(match) and await branch_member.is_member(int(match.group(1)), user_id, session)
    if subdir == 'canvas':
        match = re.match(r'^c(\d+)_', filename)
        return bool(match) and await canvas_member.is_member(int(match.group(1)), user_id, session)
    if subdir == 'chat':
        match = re.match(r'^chat_(\d+)_', filename)
        if match:
            return await chat_member.is_member(int(match.group(1)), user_id, session)
        # 레거시 chat_{uuid}.ext(SEC-18 이전, room_id 없음) — 인증 사용자에게 허용(구버전 호환).
        # 정확히 12-hex uuid 형식만 인정해, chat_word_* 같은 임의 이름이 멤버십을 우회하지 못하게 한다.
        return bool(re.match(r'^chat_[0-9a-f]{12}\.[A-Za-z0-9]+$', filename))
    return False


@router.get('/{subdir}/{filename}', dependencies=[Depends(require_login)])
async def serve_upload(subdir: str, filename: str, request: Request,
                       session: AsyncSession = Depends(db.session)):
    if not _SAFE_NAME.match(subdir) or not _SAFE_NAME.match(filename):
        return Response(status_code=404)
    # 심볼릭 링크/.. 까지 해석해 uploads 디렉터리 밖 접근 차단
    path = os.path.realpath(os.path.join(UPLOADS_DIR, subdir, filename))
    base = os.path.realpath(UPLOADS_DIR)
    if not path.startswith(base + os.sep) or not os.path.isfile(path):
        return Response(status_code=404)
    user_id = request.state.payload.get('user_id')
    if not await _is_authorized(subdir, filename, user_id, session):
        # 미존재와 동일하게 404 — 비멤버에게 파일 존재 여부를 알려주는 오라클을 막는다.
        return Response(status_code=404)
    # nosniff: MIME 스니핑 차단. SVG는 attachment로 강제해 주소창 직접 열람 시 top-level
    # 문서로 렌더되며 스크립트가 실행되는 XSS 경로를 막는다(SEC-25). <img> 로딩은
    # Content-Disposition을 무시하므로 아이콘 표시에는 영향이 없다.
    headers = {'X-Content-Type-Options': 'nosniff'}
    if filename.lower().endswith('.svg'):
        # filename은 _SAFE_NAME(영숫자·._-)로 검증돼 추가 이스케이프 불필요(RFC 6266)
        headers['Content-Disposition'] = f'attachment; filename="{filename}"'
    return FileResponse(path, headers=headers)
