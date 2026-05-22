from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(track_id: int, source_item_id: int, target_item_id: int,
                  link_type: str, created_by: int, db: AsyncSession):
    """Track 내부 edge 생성. materialize는 set_materialized_dep로 별도 갱신.
    UNIQUE(source_item_id, target_item_id, link_type) 충돌 시 기존 link 보존.
    리턴: (link_id, created) — created=False면 이미 존재했음."""
    result = await db.execute(text("""
        INSERT INTO track_link (track_id, source_item_id, target_item_id,
                                 link_type, created_by)
        VALUES (:track_id, :source_item_id, :target_item_id,
                :link_type, :created_by)
        ON CONFLICT (source_item_id, target_item_id, link_type) DO NOTHING
        RETURNING link_id
    """), {
        'track_id': track_id,
        'source_item_id': source_item_id,
        'target_item_id': target_item_id,
        'link_type': link_type,
        'created_by': created_by,
    })
    row = result.fetchone()
    if row:
        return row[0], True

    # 이미 존재 — 기존 link_id 반환
    existing = await db.execute(text("""
        SELECT link_id FROM track_link
        WHERE source_item_id = :source_item_id
          AND target_item_id = :target_item_id
          AND link_type = :link_type
    """), {
        'source_item_id': source_item_id,
        'target_item_id': target_item_id,
        'link_type': link_type,
    })
    return existing.scalar_one(), False


async def find_by_id(link_id: int, db: AsyncSession):
    """단건 조회"""
    result = await db.execute(text("""
        SELECT link_id, track_id, source_item_id, target_item_id,
               link_type, materialized_dependency_id, created_at
        FROM track_link
        WHERE link_id = :link_id
    """), {'link_id': link_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_by_track(track_id: int, db: AsyncSession):
    """Track의 모든 link 목록"""
    result = await db.execute(text("""
        SELECT link_id, source_item_id, target_item_id, link_type,
               materialized_dependency_id IS NOT NULL AS materialized,
               created_at
        FROM track_link
        WHERE track_id = :track_id
        ORDER BY link_id
    """), {'track_id': track_id})
    return [dict(r._mapping) for r in result.fetchall()]


async def set_materialized_dep(link_id: int, dep_id, db: AsyncSession):
    """link의 materialized_dependency_id 갱신 (None 가능)."""
    await db.execute(text("""
        UPDATE track_link
        SET materialized_dependency_id = CAST(:dep_id AS INTEGER)
        WHERE link_id = :link_id
    """), {'dep_id': dep_id, 'link_id': link_id})


async def delete(link_id: int, track_id: int, db: AsyncSession):
    """track_id 가드한 삭제. materialized dependency는 caller가 별도로 정리."""
    await db.execute(text("""
        DELETE FROM track_link
        WHERE link_id = :link_id AND track_id = :track_id
    """), {'link_id': link_id, 'track_id': track_id})


async def find_source_target_tasks(source_item_id: int, target_item_id: int,
                                    track_id: int, db: AsyncSession):
    """edge의 source/target item이 가리키는 task_id + branch_id 조회.
    둘 다 source_type='task' 일 때만 의미 있음. note면 None 반환."""
    result = await db.execute(text("""
        SELECT
            s.item_id AS s_item, s.source_task_id AS s_task, t1.branch_id AS s_branch,
            tgt.item_id AS t_item, tgt.source_task_id AS t_task, t2.branch_id AS t_branch
        FROM track_item s
        INNER JOIN track_item tgt ON tgt.item_id = :target_item_id
        LEFT JOIN task t1 ON s.source_task_id = t1.task_id
        LEFT JOIN task t2 ON tgt.source_task_id = t2.task_id
        WHERE s.item_id = :source_item_id
          AND s.track_id = :track_id
          AND tgt.track_id = :track_id
    """), {
        'source_item_id': source_item_id,
        'target_item_id': target_item_id,
        'track_id': track_id,
    })
    row = result.fetchone()
    return dict(row._mapping) if row else None
