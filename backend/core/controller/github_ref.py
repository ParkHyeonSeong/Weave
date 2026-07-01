import re
from urllib.parse import urlparse

from fastapi import Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.guard.branch_scope import find_resource_in_branch
from core.model import github_integration as ghi_model
from core.model import task_github_ref as ref_model
from core.model import branch_member as member_model
from library import github_app


async def _scope_task(branch_id: int, task_id: int, request: Request, db: AsyncSession):
    """STEP1 멤버 + STEP2 task-in-branch 가드. (user_id, None) 또는 (None, error)."""
    user_id = request.state.payload.get('user_id')
    # STEP 1: 호출자가 URL branch의 멤버인가
    if not await member_model.is_member(branch_id, user_id, db):
        return None, error_response(ErrorCode.NOT_BRANCH_MEMBER)
    # STEP 2: task가 정말 이 branch 소속인가 (실제 branch_id 전달 — None 금지)
    if not await find_resource_in_branch(task_id, branch_id, 'task', db):
        return None, error_response(ErrorCode.TASK_NOT_FOUND)
    return user_id, None


async def list_refs(branch_id: int, task_id: int, request: Request, db: AsyncSession):
    """태스크에 연결된 PR/커밋 목록."""
    _, err = await _scope_task(branch_id, task_id, request, db)
    if err:
        return err
    refs = await ref_model.find_by_task(task_id, db)
    return {'status': True, 'refs': refs}


async def link_ref(body, branch_id: int, task_id: int, request: Request, db: AsyncSession):
    """태스크에 PR 수동 연결. 프론트는 PR URL만 보내고, 백엔드가 owner/repo/number를 파싱한 뒤
    연결된 integration의 installation token으로 PR 메타(제목/상태)를 가져와 함께 저장한다."""
    user_id, err = await _scope_task(branch_id, task_id, request, db)
    if err:
        return err
    # P2: host가 정확히 github.com인지 검사(부분문자열 위장 URL 차단)
    parsed = urlparse(body.html_url)
    m = re.match(r'^/([^/]+)/([^/]+)/pull/(\d{1,8})$', parsed.path or '')
    if parsed.scheme != 'https' or parsed.netloc.lower() != 'github.com' or not m:
        return error_response(ErrorCode.INVALID_GITHUB_URL)
    owner, repo = m.group(1), m.group(2)
    repo_full_name = f"{owner}/{repo}"
    ref_number = int(m.group(3))
    integ = await ghi_model.find_enabled(branch_id, repo_full_name, db)
    if not integ:
        return error_response(ErrorCode.REPO_NOT_CONNECTED)
    pr = await github_app.fetch_pull_request(owner, repo, ref_number, integ['installation_id'])
    if pr is None:
        return error_response(ErrorCode.GITHUB_FETCH_FAILED)
    state = 'merged' if pr.get('merged') else pr.get('state')  # open|closed|merged
    try:
        # UNIQUE 위반은 바깥 트랜잭션을 abort시키므로 savepoint 안에서 insert (webhook insert와 동일 패턴)
        async with db.begin_nested():
            ref = await ref_model.create(
                task_id, repo_full_name, 'pull_request', ref_number,
                pr.get('merge_commit_sha'), pr.get('title'), state,
                pr.get('html_url') or body.html_url, user_id, db,
            )
    except IntegrityError:
        return error_response(ErrorCode.DUPLICATE_LINK)
    return {'status': True, 'ref': ref}


async def unlink_ref(branch_id: int, task_id: int, ref_id: int,
                     request: Request, db: AsyncSession):
    """태스크-ref 연결 해제. STEP3 = 모델의 (ref_id, task_id) 튜플 삭제."""
    _, err = await _scope_task(branch_id, task_id, request, db)
    if err:
        return err
    # STEP 3: ref가 정말 이 task 소속일 때만 삭제 (튜플 스코프 + RETURNING)
    deleted = await ref_model.delete(ref_id, task_id, db)
    if not deleted:
        return error_response(ErrorCode.REF_NOT_FOUND)
    return {'status': True}
