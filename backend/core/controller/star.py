"""Star toggle/check controller — resource access authorization (SEC-14).

A star references one of two item kinds: a ``task`` (scoped to a branch) or a
``doc`` (a canvas_page, scoped to a canvas). Before letting the caller
add/remove their own star, verify the target resource exists AND the caller is
a member of its owning branch/canvas. Without this an arbitrary item_id could
be starred/unstarred (IDOR + existence/membership enumeration).

Follows the dict-return convention ({'status': bool, 'message': CODE}) and uses
the shared branch_scope guard for the unscoped fetch + the membership models.
"""
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.guard.branch_scope import find_resource_in_branch
from core.model import star as star_model
from core.model import branch_member as branch_member_model
from core.model import canvas_member as canvas_member_model


async def _authorize_item(item_type: str, item_id: int, user_id: int,
                          db: AsyncSession):
    """Verify the caller may access the starred resource.

    Returns None when authorized, otherwise an error dict to return directly.
    """
    if item_type == 'task':
        # Unscoped fetch (branch_id=None) so we can read the task's own
        # branch_id and run our own membership check.
        task = await find_resource_in_branch(item_id, None, 'task', db)
        if task is None:
            return error_response(ErrorCode.TASK_NOT_FOUND)
        if not await branch_member_model.is_member(task['branch_id'], user_id, db):
            return error_response(ErrorCode.NOT_BRANCH_MEMBER)
        return None

    if item_type == 'doc':
        # canvas_page guard returns canvas_id (page->canvas) and branch_id.
        page = await find_resource_in_branch(item_id, None, 'canvas_page', db)
        if page is None:
            return error_response(ErrorCode.PAGE_NOT_FOUND)
        if not await canvas_member_model.is_member(page['canvas_id'], user_id, db):
            return error_response(ErrorCode.NOT_CANVAS_MEMBER)
        return None

    return error_response(ErrorCode.INVALID_ITEM_TYPE)


async def toggle(body, request, db: AsyncSession):
    """Star 토글 (대상 리소스 접근 권한 검증 후 본인 star 추가/삭제)."""
    user_id = request.state.payload.get('user_id')
    denied = await _authorize_item(body.item_type, body.item_id, user_id, db)
    if denied is not None:
        return denied
    result = await star_model.toggle(user_id, body.item_type, body.item_id, db)
    return {'status': True, 'starred': result['starred']}


async def is_starred(item_type: str, item_id: int, request, db: AsyncSession):
    """Star 여부 확인 (대상 리소스 접근 권한 검증 포함)."""
    user_id = request.state.payload.get('user_id')
    denied = await _authorize_item(item_type, item_id, user_id, db)
    if denied is not None:
        return denied
    starred = await star_model.is_starred(user_id, item_type, item_id, db)
    return {'status': True, 'starred': starred}
