from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import task as task_model


async def get_my_tasks(status, priority, branch_id, sort_by, request: Request, db: AsyncSession):
    """내가 담당자인 모든 Task 조회"""
    user_id = request.state.payload.get('user_id')
    tasks = await task_model.find_by_assignee(user_id, status, priority, branch_id, sort_by, db)
    return {'status': True, 'tasks': tasks}
