from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def find_by_branch(branch_id: int, db: AsyncSession):
    """Branch의 workflow status 목록 (sort_order순)"""
    result = await db.execute(text("""
        SELECT workflow_status_id, branch_id, key, label, color, category,
               sort_order, is_default
        FROM workflow_status
        WHERE branch_id = :branch_id
        ORDER BY sort_order, workflow_status_id
    """), {'branch_id': branch_id})
    return [dict(row._mapping) for row in result.fetchall()]


async def find_by_key(branch_id: int, key: str, db: AsyncSession):
    """key로 단일 조회"""
    result = await db.execute(text("""
        SELECT workflow_status_id, key, label, color, category, is_default
        FROM workflow_status
        WHERE branch_id = :branch_id AND key = :key
    """), {'branch_id': branch_id, 'key': key})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def create(branch_id: int, key: str, label: str, color: str,
                 category: str, sort_order: int, is_default: bool,
                 db: AsyncSession) -> int:
    """Workflow status 생성"""
    result = await db.execute(text("""
        INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order, is_default)
        VALUES (:branch_id, :key, :label, :color, :category, :sort_order, :is_default)
        RETURNING workflow_status_id
    """), {
        'branch_id': branch_id,
        'key': key,
        'label': label,
        'color': color,
        'category': category,
        'sort_order': sort_order,
        'is_default': is_default,
    })
    return result.scalar_one()


async def update(workflow_status_id: int, fields: dict, db: AsyncSession):
    """Workflow status 수정"""
    sets = ', '.join(f'{k} = :{k}' for k in fields)
    fields['workflow_status_id'] = workflow_status_id
    await db.execute(text(f"""
        UPDATE workflow_status SET {sets} WHERE workflow_status_id = :workflow_status_id
    """), fields)


async def delete(workflow_status_id: int, db: AsyncSession):
    """Workflow status 삭제"""
    await db.execute(text("""
        DELETE FROM workflow_status WHERE workflow_status_id = :workflow_status_id
    """), {'workflow_status_id': workflow_status_id})


async def reorder(items: list, db: AsyncSession):
    """순서 변경 - items: [{'id': ..., 'sort_order': ...}]"""
    for item in items:
        await db.execute(text("""
            UPDATE workflow_status SET sort_order = :sort_order
            WHERE workflow_status_id = :id
        """), item)


async def clear_default(branch_id: int, db: AsyncSession):
    """Branch의 모든 상태에서 is_default 해제"""
    await db.execute(text("""
        UPDATE workflow_status SET is_default = FALSE
        WHERE branch_id = :branch_id
    """), {'branch_id': branch_id})


async def seed_defaults(branch_id: int, db: AsyncSession):
    """Branch 생성시 기본 3개 상태 자동 생성"""
    defaults = [
        ('todo', 'To Do', '#9CA3AF', 'todo', 0, True),
        ('in_progress', 'In Progress', '#2563EB', 'in_progress', 1, False),
        ('done', 'Done', '#16A34A', 'done', 2, False),
        ('cancelled', 'Cancelled', '#DC2626', 'cancelled', 3, False),
    ]
    for key, label, color, category, sort_order, is_default in defaults:
        await db.execute(text("""
            INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order, is_default)
            VALUES (:branch_id, :key, :label, :color, :category, :sort_order, :is_default)
        """), {
            'branch_id': branch_id, 'key': key, 'label': label,
            'color': color, 'category': category,
            'sort_order': sort_order, 'is_default': is_default,
        })


async def count_tasks_with_status(branch_id: int, key: str, db: AsyncSession) -> int:
    """해당 상태를 사용하는 task 수"""
    result = await db.execute(text("""
        SELECT COUNT(*) FROM task
        WHERE branch_id = :branch_id AND status = :key
    """), {'branch_id': branch_id, 'key': key})
    return result.scalar_one()


async def count_ids_in_branch(branch_id: int, ids: list, db: AsyncSession) -> int:
    """ids 중 해당 branch에 속하는 (중복 제거된) workflow_status 수를 단일 쿼리로 반환.

    cross-branch IDOR 방어용 set-membership 체크. 호출부는 이 값을
    set(ids) 크기와 비교해 전부 branch 소속인지 all-or-nothing 판정.
    """
    if not ids:
        return 0
    result = await db.execute(text("""
        SELECT COUNT(DISTINCT workflow_status_id)
        FROM workflow_status
        WHERE branch_id = :branch_id AND workflow_status_id = ANY(:ids)
    """), {'branch_id': branch_id, 'ids': list(ids)})
    return result.scalar_one()
