"""활동 이력 서비스 - diff 계산 + 요약 생성 + activity_log 기록"""
import logging

from sqlalchemy.ext.asyncio import AsyncSession
from core.model import activity_log as log_model

logger = logging.getLogger(__name__)

# Task에서 추적할 스칼라 필드
TASK_TRACKED_FIELDS = [
    'title', 'description', 'task_type', 'status', 'priority',
    'epic_id', 'sprint_id', 'parent_task_id',
    'start_date', 'due_date',
]

# 필드 한글 이름 (요약 생성용)
FIELD_LABELS = {
    'title': '제목',
    'description': '설명',
    'task_type': '유형',
    'status': '상태',
    'priority': '우선순위',
    'epic_id': '에픽',
    'sprint_id': '스프린트',
    'parent_task_id': '상위 Task',
    'start_date': '시작일',
    'due_date': '마감일',
    'content': '내용',
}


def _compute_diffs(old: dict, new: dict, tracked_fields: list) -> list[dict]:
    """old와 new를 비교해서 변경된 필드만 반환"""
    changes = []
    for field in tracked_fields:
        if field not in new:
            continue
        old_val = old.get(field)
        new_val = new[field]
        # 둘 다 None이면 변경 아님
        if old_val is None and new_val is None:
            continue
        # str 비교 시 빈문자열/None 정규화
        if isinstance(old_val, str) and isinstance(new_val, str):
            if old_val.strip() == new_val.strip():
                continue
        elif old_val == new_val:
            continue
        changes.append({'field': field, 'old': old_val, 'new': new_val})
    return changes


def _compute_set_diff(old_items: list[dict], new_items: list[dict],
                      key: str, field_name: str) -> dict | None:
    """집합형 필드(assignees, labels) diff 계산"""
    old_set = {item[key] for item in (old_items or [])}
    new_set = {item[key] for item in (new_items or [])}

    added_keys = new_set - old_set
    removed_keys = old_set - new_set

    if not added_keys and not removed_keys:
        return None

    old_map = {item[key]: item for item in (old_items or [])}
    new_map = {item[key]: item for item in (new_items or [])}

    return {
        'field': field_name,
        'added': [new_map[k] for k in added_keys],
        'removed': [old_map[k] for k in removed_keys],
    }


def _generate_summary(action: str, changes: list, entity_label: str = '') -> str:
    """사람이 읽을 수 있는 요약 텍스트 생성"""
    if action == 'created':
        return f'{entity_label} 생성'
    if action == 'deleted':
        return f'{entity_label} 삭제'
    if action == 'moved':
        return f'{entity_label} 이동'

    # updated
    parts = []
    for ch in changes[:3]:  # 최대 3개 필드만 요약
        field = ch.get('field', '')
        label = FIELD_LABELS.get(field, field)

        if 'added' in ch or 'removed' in ch:
            # 집합형
            added = ch.get('added', [])
            removed = ch.get('removed', [])
            sub = []
            if added:
                names = [a.get('username') or a.get('label_name') or str(a) for a in added]
                sub.append(f"+{', '.join(names)}")
            if removed:
                names = [r.get('username') or r.get('label_name') or str(r) for r in removed]
                sub.append(f"-{', '.join(names)}")
            parts.append(f"{label} {' '.join(sub)}")
        elif field == 'description' or field == 'content':
            parts.append(f'{label} 수정')
        else:
            old_v = ch.get('old_label') or ch.get('old') or '-'
            new_v = ch.get('new_label') or ch.get('new') or '-'
            parts.append(f'{label} {old_v} -> {new_v}')

    return ', '.join(parts) if parts else f'{entity_label} 수정'


async def log_task_created(task_id: int, branch_id: int, actor_id: int,
                           db: AsyncSession):
    """Task 생성 로그"""
    summary = _generate_summary('created', [], 'Task')
    await log_model.create(
        entity_type='task', entity_id=task_id, actor_id=actor_id,
        action='created', changes=[], summary=summary,
        branch_id=branch_id, db=db,
    )


async def log_task_change(task_id: int, branch_id: int, actor_id: int,
                          old_task: dict, new_fields: dict, db: AsyncSession):
    """Task 필드 변경 로그"""
    changes = _compute_diffs(old_task, new_fields, TASK_TRACKED_FIELDS)

    # sprint 이름 보강
    for ch in changes:
        if ch['field'] == 'sprint_id':
            ch['old_label'] = old_task.get('sprint_name')
        elif ch['field'] == 'epic_id':
            ch['old_label'] = old_task.get('epic_name')

    if not changes:
        return

    summary = _generate_summary('updated', changes, 'Task')
    await log_model.create(
        entity_type='task', entity_id=task_id, actor_id=actor_id,
        action='updated', changes=changes, summary=summary,
        branch_id=branch_id, db=db,
    )


async def log_task_assignee_change(task_id: int, branch_id: int, actor_id: int,
                                   old_assignees: list[dict], new_assignees: list[dict],
                                   db: AsyncSession):
    """Task 담당자 변경 로그"""
    diff = _compute_set_diff(old_assignees, new_assignees, 'user_id', 'assignees')
    if not diff:
        return

    summary = _generate_summary('updated', [diff], 'Task')
    await log_model.create(
        entity_type='task', entity_id=task_id, actor_id=actor_id,
        action='updated', changes=[diff], summary=summary,
        branch_id=branch_id, db=db,
    )


async def log_task_label_change(task_id: int, branch_id: int, actor_id: int,
                                old_labels: list[dict], new_labels: list[dict],
                                db: AsyncSession):
    """Task 라벨 변경 로그"""
    diff = _compute_set_diff(old_labels, new_labels, 'label_id', 'labels')
    if not diff:
        return

    summary = _generate_summary('updated', [diff], 'Task')
    await log_model.create(
        entity_type='task', entity_id=task_id, actor_id=actor_id,
        action='updated', changes=[diff], summary=summary,
        branch_id=branch_id, db=db,
    )


async def log_task_deleted(task_id: int, branch_id: int, actor_id: int,
                           db: AsyncSession):
    """Task 삭제 로그"""
    await log_model.create(
        entity_type='task', entity_id=task_id, actor_id=actor_id,
        action='deleted', changes=[], summary='Task 삭제',
        branch_id=branch_id, db=db,
    )


async def log_canvas_page_created(page_id: int, canvas_id: int, actor_id: int,
                                  title: str, db: AsyncSession):
    """Canvas 페이지 생성 로그"""
    await log_model.create(
        entity_type='canvas_page', entity_id=page_id, actor_id=actor_id,
        action='created', changes=[], summary=f'페이지 "{title}" 생성',
        canvas_id=canvas_id, db=db,
    )


async def log_canvas_page_change(page_id: int, canvas_id: int, actor_id: int,
                                 old_page: dict, new_fields: dict, db: AsyncSession):
    """Canvas 페이지 수정 로그"""
    changes = []

    # 제목 변경
    if 'title' in new_fields and new_fields['title'] != old_page.get('title'):
        changes.append({
            'field': 'title',
            'old': old_page.get('title'),
            'new': new_fields['title'],
        })

    # content 변경 (메타데이터만)
    if 'content' in new_fields and new_fields['content'] != old_page.get('content'):
        changes.append({'field': 'content', 'changed': True})

    if not changes:
        return

    summary = _generate_summary('updated', changes, '페이지')
    await log_model.create(
        entity_type='canvas_page', entity_id=page_id, actor_id=actor_id,
        action='updated', changes=changes, summary=summary,
        canvas_id=canvas_id, db=db,
    )


async def log_canvas_page_moved(page_id: int, canvas_id: int, actor_id: int,
                                db: AsyncSession):
    """Canvas 페이지 이동 로그"""
    await log_model.create(
        entity_type='canvas_page', entity_id=page_id, actor_id=actor_id,
        action='moved', changes=[], summary='페이지 이동',
        canvas_id=canvas_id, db=db,
    )


async def log_canvas_page_deleted(page_id: int, canvas_id: int, actor_id: int,
                                  title: str, db: AsyncSession):
    """Canvas 페이지 삭제 로그"""
    await log_model.create(
        entity_type='canvas_page', entity_id=page_id, actor_id=actor_id,
        action='deleted', changes=[], summary=f'페이지 "{title}" 삭제',
        canvas_id=canvas_id, db=db,
    )
