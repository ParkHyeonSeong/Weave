import json
from datetime import date, datetime
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _sanitize_for_json(obj):
    """JSONB 저장 전 date/datetime 등 직렬화 불가 타입을 str로 변환"""
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    return obj


# 큰 본문 필드 — diff의 old/new 전체 값을 응답에 노출하지 않는다.
_SENSITIVE_CHANGE_FIELDS = {'description', 'content'}


def _redact_change(change):
    """민감 본문 필드면 old/new를 버리고 변경 플래그만 남기고, 그 외엔 그대로 둔다."""
    if isinstance(change, dict) and change.get('field') in _SENSITIVE_CHANGE_FIELDS:
        return {'field': change['field'], 'changed': True}
    return change


def _filter_sensitive_changes(activity: dict) -> dict:
    """changes에서 description/content 본문 필드의 old/new 값을 제거한다(LOG-12).

    이 필드들의 전체 본문은 프론트(ActivityTimeline)가 어차피 표시하지 않으며, raw API로
    삭제·변경된 본문이 노출되는 것을 막는다. field와 changed 플래그만 남긴다."""
    changes = activity.get('changes')
    if isinstance(changes, str):
        # JSONB는 보통 list로 디코딩되어 오지만, 비-DB/수기 입력 대비 방어적으로 파싱한다.
        try:
            changes = json.loads(changes)
        except (ValueError, TypeError):
            return activity
        if not isinstance(changes, list):
            return activity
    if isinstance(changes, list):
        activity['changes'] = [_redact_change(c) for c in changes]
    return activity


async def create(entity_type: str, entity_id: int, actor_id: int, action: str,
                 changes: list, summary: str | None = None,
                 branch_id: int | None = None, canvas_id: int | None = None,
                 db: AsyncSession = None) -> int:
    """활동 로그 생성, log_id 반환"""
    # date/datetime → str 변환 후 json.dumps로 JSONB 저장
    safe_changes = _sanitize_for_json(changes)
    result = await db.execute(text("""
        INSERT INTO activity_log
            (entity_type, entity_id, branch_id, canvas_id, actor_id, action, changes, summary)
        VALUES
            (:entity_type, :entity_id, :branch_id, :canvas_id, :actor_id, :action, :changes, :summary)
        RETURNING log_id
    """), {
        'entity_type': entity_type,
        'entity_id': entity_id,
        'branch_id': branch_id,
        'canvas_id': canvas_id,
        'actor_id': actor_id,
        'action': action,
        'changes': json.dumps(safe_changes, ensure_ascii=False),
        'summary': summary,
    })
    return result.scalar_one()


async def find_by_entity(entity_type: str, entity_id: int,
                         limit: int = 20, offset: int = 0,
                         db: AsyncSession = None) -> list[dict]:
    """특정 엔티티의 활동 이력 (최신순)"""
    result = await db.execute(text("""
        SELECT al.log_id, al.entity_type, al.entity_id, al.action,
               al.changes, al.summary, al.created_at,
               al.actor_id, u.username AS actor_name,
               u.avatar_url AS actor_avatar, u.avatar_color AS actor_avatar_color
        FROM activity_log al
        LEFT JOIN "user" u ON al.actor_id = u.user_id
        WHERE al.entity_type = :entity_type AND al.entity_id = :entity_id
        ORDER BY al.created_at DESC
        LIMIT :limit OFFSET :offset
    """), {
        'entity_type': entity_type,
        'entity_id': entity_id,
        'limit': limit,
        'offset': offset,
    })
    return [_filter_sensitive_changes(dict(r._mapping)) for r in result.fetchall()]


async def find_by_branch(branch_id: int, limit: int = 30, offset: int = 0,
                         db: AsyncSession = None) -> list[dict]:
    """브랜치 전체 활동 피드 (최신순)"""
    result = await db.execute(text("""
        SELECT al.log_id, al.entity_type, al.entity_id, al.action,
               al.changes, al.summary, al.created_at,
               al.actor_id, u.username AS actor_name,
               u.avatar_url AS actor_avatar, u.avatar_color AS actor_avatar_color
        FROM activity_log al
        LEFT JOIN "user" u ON al.actor_id = u.user_id
        WHERE al.branch_id = :branch_id
        ORDER BY al.created_at DESC
        LIMIT :limit OFFSET :offset
    """), {'branch_id': branch_id, 'limit': limit, 'offset': offset})
    return [_filter_sensitive_changes(dict(r._mapping)) for r in result.fetchall()]


async def find_by_canvas(canvas_id: int, limit: int = 30, offset: int = 0,
                         db: AsyncSession = None) -> list[dict]:
    """캔버스 전체 활동 피드 (최신순)"""
    result = await db.execute(text("""
        SELECT al.log_id, al.entity_type, al.entity_id, al.action,
               al.changes, al.summary, al.created_at,
               al.actor_id, u.username AS actor_name,
               u.avatar_url AS actor_avatar, u.avatar_color AS actor_avatar_color
        FROM activity_log al
        LEFT JOIN "user" u ON al.actor_id = u.user_id
        WHERE al.canvas_id = :canvas_id
        ORDER BY al.created_at DESC
        LIMIT :limit OFFSET :offset
    """), {'canvas_id': canvas_id, 'limit': limit, 'offset': offset})
    return [_filter_sensitive_changes(dict(r._mapping)) for r in result.fetchall()]
