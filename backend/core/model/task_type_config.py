from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(branch_id: int, type_key: str, type_name: str,
                 icon: str, color: str, sort_order: int, db: AsyncSession) -> int:
    """Task type 생성"""
    result = await db.execute(text("""
        INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
        VALUES (:branch_id, :type_key, :type_name, :icon, :color, :sort_order)
        RETURNING type_id
    """), {
        'branch_id': branch_id,
        'type_key': type_key,
        'type_name': type_name,
        'icon': icon,
        'color': color,
        'sort_order': sort_order,
    })
    await db.commit()
    return result.scalar_one()


async def find_by_branch(branch_id: int, db: AsyncSession):
    """Branch의 task type 목록"""
    result = await db.execute(text("""
        SELECT type_id, branch_id, type_key, type_name, icon, color, sort_order, created_at
        FROM task_type_config
        WHERE branch_id = :branch_id
        ORDER BY sort_order, type_id
    """), {'branch_id': branch_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def find_by_key(branch_id: int, type_key: str, db: AsyncSession):
    """type_key로 조회"""
    result = await db.execute(text("""
        SELECT type_id, type_key, type_name, icon, color
        FROM task_type_config
        WHERE branch_id = :branch_id AND type_key = :type_key
    """), {'branch_id': branch_id, 'type_key': type_key})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def update(type_id: int, fields: dict, db: AsyncSession):
    """Task type 수정"""
    sets = ', '.join(f'{k} = :{k}' for k in fields)
    fields['type_id'] = type_id
    await db.execute(text(f"""
        UPDATE task_type_config SET {sets} WHERE type_id = :type_id
    """), fields)
    await db.commit()


async def delete(type_id: int, db: AsyncSession):
    """Task type 삭제"""
    await db.execute(text("""
        DELETE FROM task_type_config WHERE type_id = :type_id
    """), {'type_id': type_id})
    await db.commit()


async def seed_defaults(branch_id: int, db: AsyncSession):
    """기본 task type 3개 시딩"""
    defaults = [
        ('task', 'Task', 'CheckSquare', '#5E6AD2', 0),
        ('bug', 'Bug', 'Bug', '#DC2626', 1),
        ('story', 'Story', 'BookOpen', '#16A34A', 2),
    ]
    for type_key, type_name, icon, color, sort_order in defaults:
        await db.execute(text("""
            INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
            VALUES (:branch_id, :type_key, :type_name, :icon, :color, :sort_order)
        """), {
            'branch_id': branch_id,
            'type_key': type_key,
            'type_name': type_name,
            'icon': icon,
            'color': color,
            'sort_order': sort_order,
        })
    await db.commit()


async def count_tasks_by_type(branch_id: int, type_key: str, db: AsyncSession) -> int:
    """해당 타입을 사용하는 task 수"""
    result = await db.execute(text("""
        SELECT COUNT(*) FROM task
        WHERE branch_id = :branch_id AND task_type = :type_key
    """), {'branch_id': branch_id, 'type_key': type_key})
    return result.scalar_one()
