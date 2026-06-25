"""Task 서브리소스(label/assignee/custom field) 부분 add/remove 컨트롤러.

update_task의 전체 replace를 건드리지 않고, 단일 항목을 안전하게
추가/제거/설정하는 전용 경로. 모든 라우트가 get_task_in_branch_or_error로
cross-branch IDOR를 먼저 차단한다.
"""
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import ErrorCode, error_response
from core.model import task as task_model
from core.model import branch_member as member_model


async def get_task_in_branch_or_error(task_id: int, branch_id: int, request: Request, db: AsyncSession):
    """(task, None) 성공 / (None, error_dict) 실패. 멤버십 + task-branch 소속 검증."""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return None, error_response(ErrorCode.NOT_BRANCH_MEMBER)
    task = await task_model.find_by_id(task_id, db)
    if not task or task['branch_id'] != branch_id:
        return None, error_response(ErrorCode.TASK_NOT_FOUND)
    return task, None
