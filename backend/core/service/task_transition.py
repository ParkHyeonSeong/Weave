"""GitHub 자동전환 서비스 — gate→category→key 해석 + 원자적 CAS + 부수효과 게이팅.

HTTP 비의존 재사용 단위. 웹훅 dispatch가 ref upsert 후 task별로 호출한다.

게이트 의미(전진 전용):
  open  : PR 열림/재오픈/ready → 목표 in_progress, 허용 현재 {todo}
  merge : PR 머지            → 목표 done,        허용 현재 {todo, in_progress}
  close : 머지 없이 닫힘       → 목표 todo,        허용 현재 {in_progress}
          (단, 이 PR 외 활성 PR(open/merged)이 남아있으면 되돌리지 않음)

status key는 브랜치별 자유 문자열이라 category로만 이식 가능 — find_by_branch로
매 호출 해석한다(키 하드코딩 금지). 목표 category를 가진 status가 브랜치에 없으면
에러가 아니라 조용히 skip(moved:False) — 링크/타임라인 기록은 호출부 책임.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import task as task_model
from core.model import workflow_status as ws_model
from core.errors import ErrorCode, error_response
from library import activity_service
from library import notification_service

GATE_TO_TARGET_CATEGORY = {
    'open': 'in_progress',
    'merge': 'done',
    'close': 'todo',
}
GATE_TO_ALLOWED_CATEGORIES = {
    'open': {'todo'},
    'merge': {'todo', 'in_progress'},
    'close': {'in_progress'},
}


async def _other_active_pr_exists(task_id: int, this_ref_id, db: AsyncSession) -> bool:
    """이 PR(this_ref_id) 외에 state in (open, merged)인 PR 링크가 남아있는지."""
    if this_ref_id is None:
        result = await db.execute(text("""
            SELECT EXISTS (
                SELECT 1 FROM task_github_ref
                WHERE task_id = :task_id
                  AND ref_type = 'pull_request'
                  AND state IN ('open', 'merged')
            )
        """), {'task_id': task_id})
    else:
        result = await db.execute(text("""
            SELECT EXISTS (
                SELECT 1 FROM task_github_ref
                WHERE task_id = :task_id
                  AND ref_type = 'pull_request'
                  AND state IN ('open', 'merged')
                  AND ref_id != :this_ref_id
            )
        """), {'task_id': task_id, 'this_ref_id': this_ref_id})
    return bool(result.scalar_one())


async def transition(task_id: int, branch_id: int, gate: str, actor_id: int,
                     db: AsyncSession, this_ref_id=None) -> dict:
    """gate에 따라 task를 원자적으로 전이하고, 이동했을 때만 활동/알림을 발사한다.

    반환:
      {'status': True, 'moved': True}  — 실제 이동(부수효과 발사됨)
      {'status': True, 'moved': False} — 선조건 불일치/목표 category 없음/close 차단(skip)
      error_response(INVALID_STATUS_TRANSITION) — gate가 미지(방어용)
    """
    if gate not in GATE_TO_TARGET_CATEGORY:
        return error_response(ErrorCode.INVALID_STATUS_TRANSITION)

    statuses = await ws_model.find_by_branch(branch_id, db)
    target_cat = GATE_TO_TARGET_CATEGORY[gate]
    allowed_cats = GATE_TO_ALLOWED_CATEGORIES[gate]

    # 목표 category를 가진 status key(여러 개면 sort_order 첫 번째)
    target_key = next((s['key'] for s in statuses if s['category'] == target_cat), None)
    if target_key is None:
        return {'status': True, 'moved': False}   # 브랜치에 목표 category 없음 → skip

    allowed_keys = [s['key'] for s in statuses if s['category'] in allowed_cats]
    if not allowed_keys:
        return {'status': True, 'moved': False}

    # close 게이트: 이 PR 외 활성 PR이 남아있으면 되돌리지 않음
    if gate == 'close' and await _other_active_pr_exists(task_id, this_ref_id, db):
        return {'status': True, 'moved': False}

    old_task = await task_model.find_by_id(task_id, db)
    if old_task is None:
        return {'status': True, 'moved': False}

    moved = await task_model.transition_status(task_id, target_key, allowed_keys, db)
    if moved is None:
        return {'status': True, 'moved': False}

    updated = await task_model.find_by_id(task_id, db)
    await activity_service.log_task_change(
        task_id, branch_id, actor_id, old_task, {'status': target_key}, updated, db)

    assignee_ids = [a['user_id'] for a in (updated.get('assignees') or [])]
    if assignee_ids:
        display_id = updated.get('display_id', '')
        title = updated.get('title', '')
        link = f'/branch/{branch_id}/task/{task_id}'
        await notification_service.notify_bulk(
            assignee_ids, 'task_status', actor_id,
            f'{display_id} {title} 상태가 변경되었습니다',
            link, 'task', task_id, db)

    return {'status': True, 'moved': True}
