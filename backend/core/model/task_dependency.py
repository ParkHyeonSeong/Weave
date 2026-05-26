from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(branch_id, source_task_id: int, target_task_id: int,
                 dep_type: str, created_by: int, db: AsyncSession) -> int:
    """의존관계 생성. branch_id=None 이면 cross-branch (045 migration)."""
    result = await db.execute(text("""
        INSERT INTO task_dependency (branch_id, source_task_id, target_task_id, dep_type, created_by)
        VALUES (CAST(:branch_id AS INTEGER), :source_task_id, :target_task_id, :dep_type, :created_by)
        RETURNING dependency_id
    """), {
        'branch_id': branch_id,
        'source_task_id': source_task_id,
        'target_task_id': target_task_id,
        'dep_type': dep_type,
        'created_by': created_by,
    })
    return result.scalar_one()


async def delete_by_id(dependency_id: int, db: AsyncSession):
    """branch_id 가드 없이 dependency_id로만 삭제 (cross-branch dep 정리용)."""
    await db.execute(text("""
        DELETE FROM task_dependency WHERE dependency_id = :dependency_id
    """), {'dependency_id': dependency_id})


async def delete_by_ids(dependency_ids: list, db: AsyncSession):
    """여러 dependency를 한 번에 정리 (bulk unparticipate 등)."""
    if not dependency_ids:
        return
    await db.execute(text("""
        DELETE FROM task_dependency WHERE dependency_id = ANY(:ids)
    """), {'ids': dependency_ids})


async def find_by_epic(epic_id: int, branch_id: int, db: AsyncSession):
    """에픽에 속한 태스크 간 의존관계 조회"""
    result = await db.execute(text("""
        SELECT d.dependency_id, d.source_task_id, d.target_task_id,
               d.dep_type, d.created_at
        FROM task_dependency d
        INNER JOIN task t1 ON d.source_task_id = t1.task_id
        INNER JOIN task t2 ON d.target_task_id = t2.task_id
        WHERE d.branch_id = :branch_id
          AND t1.epic_id = :epic_id
          AND t2.epic_id = :epic_id
        ORDER BY d.created_at
    """), {'epic_id': epic_id, 'branch_id': branch_id})
    return [dict(row._mapping) for row in result.fetchall()]


async def find_by_task(task_id: int, branch_id: int, db: AsyncSession):
    """태스크의 의존관계 조회 (상대 태스크 정보 포함)"""
    result = await db.execute(text("""
        SELECT d.dependency_id, d.source_task_id, d.target_task_id, d.dep_type,
               CASE WHEN d.source_task_id = :task_id THEN 'outgoing' ELSE 'incoming' END AS direction,
               t.task_id, t.title, t.status,
               COALESCE(b.key, '') || '-' || t.display_number AS display_id
        FROM task_dependency d
        INNER JOIN task t ON t.task_id = CASE
            WHEN d.source_task_id = :task_id THEN d.target_task_id
            ELSE d.source_task_id
        END
        LEFT JOIN branch b ON t.branch_id = b.branch_id
        WHERE d.branch_id = :branch_id
          AND (d.source_task_id = :task_id OR d.target_task_id = :task_id)
        ORDER BY d.dep_type, d.created_at
    """), {'task_id': task_id, 'branch_id': branch_id})
    return [dict(row._mapping) for row in result.fetchall()]


async def delete(dependency_id: int, branch_id: int, db: AsyncSession):
    """의존관계 삭제"""
    await db.execute(text("""
        DELETE FROM task_dependency
        WHERE dependency_id = :dependency_id AND branch_id = :branch_id
    """), {'dependency_id': dependency_id, 'branch_id': branch_id})


async def check_circular(source_task_id: int, target_task_id: int,
                          branch_id, db: AsyncSession) -> bool:
    """finish_to_start 순환 참조 체크 (True = 순환 발생).
    branch_id=None 이면 cross-branch 전체 의존 그래프 탐색.
    """
    result = await db.execute(text("""
        WITH RECURSIVE chain AS (
            SELECT target_task_id AS tid
            FROM task_dependency
            WHERE source_task_id = :target
              AND dep_type = 'finish_to_start'
              AND (CAST(:branch_id AS INTEGER) IS NULL
                   OR branch_id = CAST(:branch_id AS INTEGER))
            UNION
            SELECT td.target_task_id
            FROM task_dependency td
            INNER JOIN chain c ON td.source_task_id = c.tid
            WHERE td.dep_type = 'finish_to_start'
              AND (CAST(:branch_id AS INTEGER) IS NULL
                   OR td.branch_id = CAST(:branch_id AS INTEGER))
        )
        SELECT EXISTS (SELECT 1 FROM chain WHERE tid = :source)
    """), {
        'source': source_task_id,
        'target': target_task_id,
        'branch_id': branch_id,
    })
    return result.scalar_one()
