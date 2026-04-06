import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(entity_type: str, entity_id: int, actor_id: int, action: str,
                 changes: list, summary: str | None = None,
                 branch_id: int | None = None, canvas_id: int | None = None,
                 db: AsyncSession = None) -> int:
    """활동 로그 생성, log_id 반환"""
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
        'changes': json.dumps(changes, ensure_ascii=False, default=str),
        'summary': summary,
    })
    await db.commit()
    return result.scalar_one()


async def find_by_entity(entity_type: str, entity_id: int,
                         limit: int = 20, offset: int = 0,
                         db: AsyncSession = None) -> list[dict]:
    """특정 엔티티의 활동 이력 (최신순)"""
    result = await db.execute(text("""
        SELECT al.log_id, al.entity_type, al.entity_id, al.action,
               al.changes, al.summary, al.created_at,
               al.actor_id, u.username AS actor_name, u.avatar_url AS actor_avatar
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
    return [dict(r._mapping) for r in result.fetchall()]


async def find_by_branch(branch_id: int, limit: int = 30, offset: int = 0,
                         db: AsyncSession = None) -> list[dict]:
    """브랜치 전체 활동 피드 (최신순)"""
    result = await db.execute(text("""
        SELECT al.log_id, al.entity_type, al.entity_id, al.action,
               al.changes, al.summary, al.created_at,
               al.actor_id, u.username AS actor_name, u.avatar_url AS actor_avatar
        FROM activity_log al
        LEFT JOIN "user" u ON al.actor_id = u.user_id
        WHERE al.branch_id = :branch_id
        ORDER BY al.created_at DESC
        LIMIT :limit OFFSET :offset
    """), {'branch_id': branch_id, 'limit': limit, 'offset': offset})
    return [dict(r._mapping) for r in result.fetchall()]


async def find_by_canvas(canvas_id: int, limit: int = 30, offset: int = 0,
                         db: AsyncSession = None) -> list[dict]:
    """캔버스 전체 활동 피드 (최신순)"""
    result = await db.execute(text("""
        SELECT al.log_id, al.entity_type, al.entity_id, al.action,
               al.changes, al.summary, al.created_at,
               al.actor_id, u.username AS actor_name, u.avatar_url AS actor_avatar
        FROM activity_log al
        LEFT JOIN "user" u ON al.actor_id = u.user_id
        WHERE al.canvas_id = :canvas_id
        ORDER BY al.created_at DESC
        LIMIT :limit OFFSET :offset
    """), {'canvas_id': canvas_id, 'limit': limit, 'offset': offset})
    return [dict(r._mapping) for r in result.fetchall()]
