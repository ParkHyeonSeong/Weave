from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import task as task_model
from core.model import branch_member as member_model
from core.model import task_type_config as type_model
from core.model import workflow_status as ws_model
from core.model import recent_view
from library import notification_service
from library import activity_service
from library.mention_parser import extract_mention_user_ids


async def create(body, branch_id: int, request: Request, db: AsyncSession):
    """Task 생성"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    # task_type 동적 검증
    valid_type = await type_model.find_by_key(branch_id, body.task_type, db)
    if not valid_type:
        return {'status': False, 'message': 'INVALID_TASK_TYPE'}

    # status 동적 검증 (workflow_status)
    valid_status = await ws_model.find_by_key(branch_id, body.status, db)
    if not valid_status:
        return {'status': False, 'message': 'INVALID_STATUS'}

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
        custom_fields=body.custom_fields,
    )

    # 라벨 할당
    if body.label_ids:
        await task_model.set_labels(task_id, body.label_ids, db)

    # 담당자 할당
    if body.assignees:
        await task_model.set_assignees(task_id, body.assignees.main, body.assignees.sub or [], db)

    # description 멘션 알림
    mentioned = extract_mention_user_ids(body.description)
    if mentioned:
        username = request.state.payload.get('username', '')
        prefix = f'{body.task_type.upper()}-{display_number}'
        link = f'/branch/{branch_id}/task/{task_id}'
        await notification_service.notify_bulk(
            mentioned, 'mention', user_id,
            f'{username}님이 {prefix} {body.title}에서 회원님을 멘션했습니다',
            link, 'task', task_id, db,
        )

    # 활동 로그
    await activity_service.log_task_created(task_id, branch_id, user_id, db)

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

    # workflow_status 기반 동적 컬럼
    statuses = await ws_model.find_by_branch(branch_id, db)
    columns = {s['key']: [] for s in statuses}
    for task in tasks:
        key = task['status']
        if key in columns:
            columns[key].append(task)
        else:
            # 매칭되지 않는 status는 첫번째 컬럼에 배치
            first_key = statuses[0]['key'] if statuses else 'todo'
            columns.setdefault(first_key, []).append(task)

    return {'status': True, 'columns': columns, 'statuses': statuses}


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

    # status 동적 검증
    if 'status' in fields and fields['status'] is not None:
        valid_status = await ws_model.find_by_key(branch_id, fields['status'], db)
        if not valid_status:
            return {'status': False, 'message': 'INVALID_STATUS'}

    if fields:
        await task_model.update(task_id, fields, db)
        # 필드 변경 활동 로그
        await activity_service.log_task_change(task_id, branch_id, user_id, task, fields, db)

    # description 멘션 알림 (새로 추가된 멘션만)
    if 'description' in fields and fields['description']:
        old_mentions = set(extract_mention_user_ids(task.get('description') or ''))
        new_mentions = set(extract_mention_user_ids(fields['description']))
        added_mentions = new_mentions - old_mentions
        if added_mentions:
            username = request.state.payload.get('username', '')
            display_id = task.get('display_id', '')
            link = f'/branch/{branch_id}/task/{task_id}'
            await notification_service.notify_bulk(
                list(added_mentions), 'mention', user_id,
                f'{username}님이 {display_id} {task.get("title", "")}에서 회원님을 멘션했습니다',
                link, 'task', task_id, db,
            )

    # 라벨 업데이트
    if body.label_ids is not None:
        old_labels = task.get('labels') or []
        await task_model.set_labels(task_id, body.label_ids, db)
        # 새 라벨 목록 조회 후 diff 로깅
        updated_task = await task_model.find_by_id(task_id, db)
        new_labels = updated_task.get('labels') or []
        await activity_service.log_task_label_change(task_id, branch_id, user_id, old_labels, new_labels, db)

    # 담당자 업데이트 + 알림
    if body.assignees is not None:
        # 이전 담당자 목록
        old_assignees_list = task.get('assignees') or []
        old_assignee_ids = set()
        for a in old_assignees_list:
            old_assignee_ids.add(a['user_id'])

        await task_model.set_assignees(task_id, body.assignees.main, body.assignees.sub or [], db)

        # 담당자 변경 활동 로그
        updated_task_for_assignees = await task_model.find_by_id(task_id, db)
        new_assignees_list = updated_task_for_assignees.get('assignees') or []
        await activity_service.log_task_assignee_change(
            task_id, branch_id, user_id, old_assignees_list, new_assignees_list, db
        )

        # 새로 추가된 담당자에게 알림
        new_assignee_ids = set()
        if body.assignees.main:
            new_assignee_ids.add(body.assignees.main)
        for sub_id in (body.assignees.sub or []):
            new_assignee_ids.add(sub_id)

        added = new_assignee_ids - old_assignee_ids
        if added:
            display_id = task.get('display_id', '')
            title = task.get('title', '')
            username = request.state.payload.get('username', '')
            link = f'/branch/{branch_id}/task/{task_id}'
            await notification_service.notify_bulk(
                list(added), 'task_assigned', user_id,
                f'{username}님이 {display_id} {title}에 회원님을 담당자로 지정했습니다',
                link, 'task', task_id, db,
            )

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

    await activity_service.log_task_deleted(task_id, branch_id, user_id, db)
    await task_model.delete(task_id, db)
    return {'status': True}
