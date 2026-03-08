from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import task as task_model
from core.model import branch_member as member_model
from core.model import task_type_config as type_model
from core.model import recent_view


async def create(body, branch_id: int, request: Request, db: AsyncSession):
    """Task 생성"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    # task_type 동적 검증
    valid_type = await type_model.find_by_key(branch_id, body.task_type, db)
    if not valid_type:
        return {'status': False, 'message': 'INVALID_TASK_TYPE'}

    # display_number 발급
    display_number = await task_model.next_display_number(branch_id, db)

    task_id = await task_model.create(
        branch_id=branch_id,
        display_number=display_number,
        title=body.title,
        description=body.description,
        task_type=body.task_type,
        status=body.status,
        priority=body.priority,
        epic_id=body.epic_id,
        sprint_id=body.sprint_id,
        parent_task_id=body.parent_task_id,
        start_date=body.start_date,
        due_date=body.due_date,
        created_by=user_id,
        db=db,
    )

    # 라벨 할당
    if body.label_ids:
        await task_model.set_labels(task_id, body.label_ids, db)

    # 담당자 할당
    if body.assignees:
        await task_model.set_assignees(task_id, body.assignees.main, body.assignees.sub or [], db)

    return {'status': True, 'task_id': task_id, 'display_number': display_number}


async def get_detail(task_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Task 상세"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    task = await task_model.find_by_id(task_id, db)
    if not task or task['branch_id'] != branch_id:
        return {'status': False, 'message': 'TASK_NOT_FOUND'}

    # subtask 목록
    subtasks = await task_model.find_subtasks(task_id, db)
    task['subtasks'] = subtasks

    # 조회 기록
    await recent_view.upsert(user_id, 'task', task_id, db)

    return {'status': True, 'task': task}


async def get_list(branch_id: int, sprint_id, request: Request, db: AsyncSession):
    """Task 목록 (sprint_id 필터)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    tasks = await task_model.find_by_branch(branch_id, sprint_id, db)
    return {'status': True, 'tasks': tasks}


async def get_board(branch_id: int, sprint_id, request: Request, db: AsyncSession):
    """Board 탭용 Task 목록"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    tasks = await task_model.find_for_board(branch_id, sprint_id, db)

    # 상태별 그룹핑
    columns = {'todo': [], 'in_progress': [], 'done': []}
    for task in tasks:
        status = task['status']
        if status in columns:
            columns[status].append(task)

    return {'status': True, 'columns': columns}


async def get_archive(branch_id: int, request: Request, db: AsyncSession):
    """완료된 Task 목록 (Archive 탭)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    tasks = await task_model.find_archived(branch_id, db)
    return {'status': True, 'tasks': tasks}


async def update(task_id: int, body, branch_id: int, request: Request, db: AsyncSession):
    """Task 수정"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    task = await task_model.find_by_id(task_id, db)
    if not task or task['branch_id'] != branch_id:
        return {'status': False, 'message': 'TASK_NOT_FOUND'}

    fields = body.model_dump(exclude_unset=True, exclude={'label_ids', 'assignees'})
    if fields:
        await task_model.update(task_id, fields, db)

    # 라벨 업데이트
    if body.label_ids is not None:
        await task_model.set_labels(task_id, body.label_ids, db)

    # 담당자 업데이트
    if body.assignees is not None:
        await task_model.set_assignees(task_id, body.assignees.main, body.assignees.sub or [], db)

    return {'status': True}


async def reorder(body, branch_id: int, request: Request, db: AsyncSession):
    """Task 이동 + 순서 변경"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    await task_model.reorder(branch_id, body.task_ids, body.sprint_id, body.after_task_id, db)
    return {'status': True}


async def delete(task_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Task 삭제"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    task = await task_model.find_by_id(task_id, db)
    if not task or task['branch_id'] != branch_id:
        return {'status': False, 'message': 'TASK_NOT_FOUND'}

    await task_model.delete(task_id, db)
    return {'status': True}
