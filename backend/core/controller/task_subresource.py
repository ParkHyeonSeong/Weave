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
from library import activity_service


async def get_task_in_branch_or_error(task_id: int, branch_id: int, request: Request, db: AsyncSession):
    """(task, None) 성공 / (None, error_dict) 실패. 멤버십 + task-branch 소속 검증."""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return None, error_response(ErrorCode.NOT_BRANCH_MEMBER)
    task = await task_model.find_by_id(task_id, db)
    if not task or task['branch_id'] != branch_id:
        return None, error_response(ErrorCode.TASK_NOT_FOUND)
    return task, None


async def add_task_label(task_id: int, label_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Task에 라벨 하나 추가(기존 라벨 유지)."""
    task, err = await get_task_in_branch_or_error(task_id, branch_id, request, db)
    if err:
        return err
    if await task_model.count_label_ids_in_branch(branch_id, [label_id], db) != 1:
        return error_response(ErrorCode.LABEL_NOT_FOUND)
    user_id = request.state.payload.get('user_id')
    old_labels = task.get('labels') or []
    await task_model.add_label(task_id, label_id, db)
    updated = await task_model.find_by_id(task_id, db)
    await activity_service.log_task_label_change(
        task_id, branch_id, user_id, old_labels, updated.get('labels') or [], db)
    return {'status': True}


async def remove_task_label(task_id: int, label_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Task에서 라벨 하나 제거."""
    task, err = await get_task_in_branch_or_error(task_id, branch_id, request, db)
    if err:
        return err
    if await task_model.count_label_ids_in_branch(branch_id, [label_id], db) != 1:
        return error_response(ErrorCode.LABEL_NOT_FOUND)
    user_id = request.state.payload.get('user_id')
    old_labels = task.get('labels') or []
    await task_model.remove_label(task_id, label_id, db)
    updated = await task_model.find_by_id(task_id, db)
    await activity_service.log_task_label_change(
        task_id, branch_id, user_id, old_labels, updated.get('labels') or [], db)
    return {'status': True}
