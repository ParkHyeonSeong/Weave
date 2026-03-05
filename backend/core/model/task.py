from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def next_display_number(branch_id: int, db: AsyncSession) -> int:
    """Branch별 task 번호 원자적 증가"""
    result = await db.execute(text("""
        UPDATE task_sequence
        SET last_number = last_number + 1
        WHERE branch_id = :branch_id
        RETURNING last_number
    """), {'branch_id': branch_id})
    row = result.fetchone()
    if not row:
        # task_sequence가 아직 없는 Branch (기존 Branch 대응)
        await db.execute(text("""
            INSERT INTO task_sequence (branch_id, last_number)
            VALUES (:branch_id, 1)
        """), {'branch_id': branch_id})
        return 1
    return row[0]


async def create(branch_id: int, display_number: int, title: str,
                 description: str, task_type: str, status: str, priority: str,
                 epic_id, sprint_id, parent_task_id, assignee_id,
                 start_date, due_date, created_by: int, db: AsyncSession) -> int:
    """Task 생성"""
    result = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, description,
                          task_type, status, priority, epic_id, sprint_id,
                          parent_task_id, assignee_id, start_date, due_date, created_by)
        VALUES (:branch_id, :display_number, :title, :description,
                :task_type, :status, :priority, :epic_id, :sprint_id,
                :parent_task_id, :assignee_id, :start_date, :due_date, :created_by)
        RETURNING task_id
    """), {
        'branch_id': branch_id,
        'display_number': display_number,
        'title': title,
        'description': description,
        'task_type': task_type,
        'status': status,
        'priority': priority,
        'epic_id': epic_id,
        'sprint_id': sprint_id,
        'parent_task_id': parent_task_id,
        'assignee_id': assignee_id,
        'start_date': start_date,
        'due_date': due_date,
        'created_by': created_by,
    })
    await db.commit()
    return result.scalar_one()


async def find_by_id(task_id: int, db: AsyncSession):
    """Task 상세 조회 (라벨, 담당자, 에픽, 스프린트 정보 포함)"""
    result = await db.execute(text("""
        SELECT t.task_id, t.branch_id, t.display_number, t.title, t.description,
               t.task_type, t.status, t.priority,
               t.epic_id, t.sprint_id, t.parent_task_id, t.assignee_id,
               t.start_date, t.due_date, t.sort_order,
               t.created_by, t.created_at, t.updated_at,
               b.key AS branch_key,
               u.username AS assignee_name,
               e.epic_name,
               s.sprint_name
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN "user" u ON t.assignee_id = u.user_id
        LEFT JOIN epic e ON t.epic_id = e.epic_id
        LEFT JOIN sprint s ON t.sprint_id = s.sprint_id
        WHERE t.task_id = :task_id
    """), {'task_id': task_id})
    row = result.fetchone()
    if not row:
        return None

    task = dict(row._mapping)
    task['display_id'] = f"{task['branch_key']}-{task['display_number']}"

    # 라벨 조회
    labels_result = await db.execute(text("""
        SELECT l.label_id, l.label_name, l.color
        FROM task_label tl
        INNER JOIN label l ON tl.label_id = l.label_id
        WHERE tl.task_id = :task_id
        ORDER BY l.label_name
    """), {'task_id': task_id})
    task['labels'] = [dict(r._mapping) for r in labels_result.fetchall()]

    return task


async def find_by_branch(branch_id: int, sprint_id, db: AsyncSession):
    """Branch의 Task 목록 (Tasks 탭용, sprint_id 필터 가능)"""
    if sprint_id is not None:
        where_sprint = "AND t.sprint_id = :sprint_id"
        params = {'branch_id': branch_id, 'sprint_id': sprint_id}
    else:
        where_sprint = "AND t.sprint_id IS NULL"
        params = {'branch_id': branch_id}

    result = await db.execute(text(f"""
        SELECT t.task_id, t.display_number, t.title,
               t.task_type, t.status, t.priority,
               t.epic_id, t.sprint_id, t.parent_task_id, t.assignee_id,
               t.start_date, t.due_date, t.sort_order, t.created_at,
               b.key AS branch_key,
               u.username AS assignee_name,
               e.epic_name, e.color AS epic_color
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN "user" u ON t.assignee_id = u.user_id
        LEFT JOIN epic e ON t.epic_id = e.epic_id
        WHERE t.branch_id = :branch_id AND t.parent_task_id IS NULL
              {where_sprint}
        ORDER BY t.sort_order, t.created_at
    """), params)
    rows = result.fetchall()
    tasks = []
    for row in rows:
        task = dict(row._mapping)
        task['display_id'] = f"{task['branch_key']}-{task['display_number']}"
        tasks.append(task)

    # 라벨 일괄 조회
    if tasks:
        task_ids = [t['task_id'] for t in tasks]
        placeholders = ', '.join(str(tid) for tid in task_ids)
        labels_result = await db.execute(text(f"""
            SELECT tl.task_id, l.label_id, l.label_name, l.color
            FROM task_label tl
            INNER JOIN label l ON tl.label_id = l.label_id
            WHERE tl.task_id IN ({placeholders})
            ORDER BY l.label_name
        """))
        label_map = {}
        for lr in labels_result.fetchall():
            ld = dict(lr._mapping)
            label_map.setdefault(ld['task_id'], []).append({
                'label_id': ld['label_id'],
                'label_name': ld['label_name'],
                'color': ld['color'],
            })
        for task in tasks:
            task['labels'] = label_map.get(task['task_id'], [])

    return tasks


async def find_for_board(branch_id: int, sprint_id, db: AsyncSession):
    """Board 탭용 Task 목록"""
    params = {'branch_id': branch_id}
    if sprint_id is not None:
        where_sprint = "AND t.sprint_id = :sprint_id"
        params['sprint_id'] = sprint_id
    else:
        where_sprint = ""

    result = await db.execute(text(f"""
        SELECT t.task_id, t.display_number, t.title,
               t.task_type, t.status, t.priority,
               t.assignee_id, t.sort_order,
               b.key AS branch_key,
               u.username AS assignee_name
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN "user" u ON t.assignee_id = u.user_id
        WHERE t.branch_id = :branch_id AND t.parent_task_id IS NULL
              {where_sprint}
        ORDER BY t.sort_order, t.created_at
    """), params)
    rows = result.fetchall()
    tasks = []
    for row in rows:
        task = dict(row._mapping)
        task['display_id'] = f"{task['branch_key']}-{task['display_number']}"
        tasks.append(task)

    # 라벨 일괄 조회
    if tasks:
        task_ids = [t['task_id'] for t in tasks]
        placeholders = ', '.join(str(tid) for tid in task_ids)
        labels_result = await db.execute(text(f"""
            SELECT tl.task_id, l.label_id, l.label_name, l.color
            FROM task_label tl
            INNER JOIN label l ON tl.label_id = l.label_id
            WHERE tl.task_id IN ({placeholders})
        """))
        label_map = {}
        for lr in labels_result.fetchall():
            ld = dict(lr._mapping)
            label_map.setdefault(ld['task_id'], []).append({
                'label_id': ld['label_id'],
                'label_name': ld['label_name'],
                'color': ld['color'],
            })
        for task in tasks:
            task['labels'] = label_map.get(task['task_id'], [])

    return tasks


async def find_subtasks(parent_task_id: int, db: AsyncSession):
    """하위 Task 목록"""
    result = await db.execute(text("""
        SELECT t.task_id, t.display_number, t.title,
               t.task_type, t.status, t.priority, t.assignee_id,
               t.sort_order, t.created_at,
               b.key AS branch_key,
               u.username AS assignee_name
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN "user" u ON t.assignee_id = u.user_id
        WHERE t.parent_task_id = :parent_task_id
        ORDER BY t.sort_order, t.created_at
    """), {'parent_task_id': parent_task_id})
    rows = result.fetchall()
    tasks = []
    for row in rows:
        task = dict(row._mapping)
        task['display_id'] = f"{task['branch_key']}-{task['display_number']}"
        tasks.append(task)
    return tasks


async def update(task_id: int, fields: dict, db: AsyncSession):
    """Task 수정 (동적 필드)"""
    allowed = {'title', 'description', 'task_type', 'status', 'priority',
               'epic_id', 'sprint_id', 'assignee_id', 'start_date', 'due_date', 'sort_order'}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return

    set_parts = [f'{k} = :{k}' for k in updates]
    set_parts.append('updated_at = NOW()')
    set_clause = ', '.join(set_parts)
    updates['task_id'] = task_id
    await db.execute(text(f"""
        UPDATE task SET {set_clause} WHERE task_id = :task_id
    """), updates)
    await db.commit()


async def delete(task_id: int, db: AsyncSession):
    """Task 삭제 (subtask도 CASCADE 삭제)"""
    await db.execute(text("""
        DELETE FROM task WHERE task_id = :task_id
    """), {'task_id': task_id})
    await db.commit()


async def set_labels(task_id: int, label_ids: list, db: AsyncSession):
    """Task 라벨 전체 교체"""
    await db.execute(text("""
        DELETE FROM task_label WHERE task_id = :task_id
    """), {'task_id': task_id})
    for label_id in label_ids:
        await db.execute(text("""
            INSERT INTO task_label (task_id, label_id) VALUES (:task_id, :label_id)
        """), {'task_id': task_id, 'label_id': label_id})
    await db.commit()
