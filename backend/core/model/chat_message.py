from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(room_id: int, sender_id: int, content: str, db: AsyncSession,
                 task_id: int = None, canvas_page_id: int = None,
                 issue_id: int = None) -> dict:
    """메시지 생성 및 생성된 메시지 반환"""
    result = await db.execute(text("""
        INSERT INTO chat_message (room_id, sender_id, content, task_id, canvas_page_id, issue_id)
        VALUES (:room_id, :sender_id, :content, :task_id, :canvas_page_id, :issue_id)
        RETURNING message_id, room_id, sender_id, content, task_id, canvas_page_id, issue_id, created_at
    """), {'room_id': room_id, 'sender_id': sender_id, 'content': content,
           'task_id': task_id, 'canvas_page_id': canvas_page_id, 'issue_id': issue_id})
    await db.commit()
    row = result.fetchone()
    return dict(row._mapping)


async def find_by_room(room_id: int, limit: int, offset: int, db: AsyncSession):
    """채팅방 메시지 목록 (최신순, 페이지네이션, task_ref 포함)"""
    result = await db.execute(text("""
        SELECT cm.message_id, cm.room_id, cm.sender_id, cm.content, cm.created_at,
               u.username AS sender_name,
               t.task_id AS ref_task_id, t.branch_id AS ref_branch_id,
               t.display_number AS ref_display_number,
               t.title AS ref_task_title, t.status AS ref_task_status,
               t.priority AS ref_task_priority,
               b.key AS ref_branch_key,
               (SELECT u2.username FROM task_assignee ta2
                INNER JOIN "user" u2 ON ta2.user_id = u2.user_id
                WHERE ta2.task_id = t.task_id AND ta2.role = 'main'
                LIMIT 1) AS ref_main_assignee_name,
               cp.page_id AS ref_page_id, cp.canvas_id AS ref_canvas_id,
               cp.title AS ref_page_title,
               c.canvas_name AS ref_canvas_name,
               ti.issue_id AS ref_issue_id, ti.task_id AS ref_issue_task_id,
               ti.title AS ref_issue_title, ti.status AS ref_issue_status,
               it.branch_id AS ref_issue_branch_id,
               it.display_number AS ref_issue_display_number,
               ib.key AS ref_issue_branch_key
        FROM chat_message cm
        INNER JOIN "user" u ON cm.sender_id = u.user_id
        LEFT JOIN task t ON cm.task_id = t.task_id
        LEFT JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN canvas_page cp ON cm.canvas_page_id = cp.page_id
        LEFT JOIN canvas c ON cp.canvas_id = c.canvas_id
        LEFT JOIN task_issue ti ON cm.issue_id = ti.issue_id
        LEFT JOIN task it ON ti.task_id = it.task_id
        LEFT JOIN branch ib ON it.branch_id = ib.branch_id
        WHERE cm.room_id = :room_id
        ORDER BY cm.created_at DESC
        LIMIT :limit OFFSET :offset
    """), {'room_id': room_id, 'limit': limit, 'offset': offset})
    rows = result.fetchall()
    messages = []
    for row in rows:
        msg = dict(row._mapping)
        # task_ref 객체 구성
        if msg.get('ref_task_id'):
            msg['task_ref'] = {
                'task_id': msg['ref_task_id'],
                'branch_id': msg['ref_branch_id'],
                'display_id': f"{msg['ref_branch_key']}-{msg['ref_display_number']}",
                'title': msg['ref_task_title'],
                'status': msg['ref_task_status'],
                'priority': msg['ref_task_priority'],
                'assignee_name': msg['ref_main_assignee_name'],
            }
        else:
            msg['task_ref'] = None
        # doc_ref 객체 구성
        if msg.get('ref_page_id'):
            msg['doc_ref'] = {
                'page_id': msg['ref_page_id'],
                'canvas_id': msg['ref_canvas_id'],
                'title': msg['ref_page_title'],
                'canvas_name': msg['ref_canvas_name'],
            }
        else:
            msg['doc_ref'] = None
        # issue_ref 객체 구성
        if msg.get('ref_issue_id'):
            msg['issue_ref'] = {
                'issue_id': msg['ref_issue_id'],
                'task_id': msg['ref_issue_task_id'],
                'branch_id': msg['ref_issue_branch_id'],
                'display_id': f"{msg['ref_issue_branch_key']}-{msg['ref_issue_display_number']}",
                'title': msg['ref_issue_title'],
                'status': msg['ref_issue_status'],
            }
        else:
            msg['issue_ref'] = None
        # ref_ 접두사 키 제거
        for key in list(msg.keys()):
            if key.startswith('ref_'):
                del msg[key]
        messages.append(msg)
    return messages
