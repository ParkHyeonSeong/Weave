from fastapi import Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import github_integration as ghi_model
from core.model import branch_member as member_model


async def _require_admin(branch_id: int, request: Request, db: AsyncSession):
    """브랜치 admin만 통과. (user_id, None) 또는 (None, error_response)."""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return None, error_response(ErrorCode.PERMISSION_DENIED)
    return user_id, None


async def list_integrations(branch_id: int, request: Request, db: AsyncSession):
    """브랜치의 GitHub 연결 목록 (admin)."""
    _, err = await _require_admin(branch_id, request, db)
    if err:
        return err
    rows = await ghi_model.find_by_branch(branch_id, db)
    return {'status': True, 'integrations': rows}


async def create_integration(body, branch_id: int, request: Request, db: AsyncSession):
    """브랜치-레포 연결 생성 (admin)."""
    user_id, err = await _require_admin(branch_id, request, db)
    if err:
        return err
    try:
        # UNIQUE 위반이 바깥 트랜잭션을 abort시키지 않게 savepoint 안에서 insert
        async with db.begin_nested():
            row = await ghi_model.create(
                branch_id, body.repo_full_name, body.installation_id, user_id, db
            )
    except IntegrityError:
        # UNIQUE(branch_id, repo_full_name) 위반 = 이미 연결됨
        return error_response(ErrorCode.DUPLICATE_LINK)
    return {'status': True, 'integration': row}


async def set_enabled(branch_id: int, integration_id: int, body,
                      request: Request, db: AsyncSession):
    """연결 활성/비활성 토글 (admin, branch 튜플 스코프)."""
    _, err = await _require_admin(branch_id, request, db)
    if err:
        return err
    row = await ghi_model.set_enabled(integration_id, branch_id, body.enabled, db)
    if not row:
        return error_response(ErrorCode.INTEGRATION_NOT_FOUND)
    return {'status': True, 'integration': row}


async def delete_integration(branch_id: int, integration_id: int,
                             request: Request, db: AsyncSession):
    """연결 삭제 (admin, branch 튜플 스코프)."""
    _, err = await _require_admin(branch_id, request, db)
    if err:
        return err
    deleted = await ghi_model.delete(integration_id, branch_id, db)
    if not deleted:
        return error_response(ErrorCode.INTEGRATION_NOT_FOUND)
    return {'status': True}
