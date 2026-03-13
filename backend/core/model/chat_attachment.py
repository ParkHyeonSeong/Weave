from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def bulk_create(message_id: int, attachments: list[dict], db: AsyncSession):
    """첨부파일 일괄 저장. attachments = [{ file_url, file_name, file_type, file_size }]"""
    for att in attachments:
        await db.execute(text("""
            INSERT INTO chat_attachment (message_id, file_url, file_name, file_type, file_size)
            VALUES (:message_id, :file_url, :file_name, :file_type, :file_size)
        """), {
            'message_id': message_id,
            'file_url': att['file_url'],
            'file_name': att['file_name'],
            'file_type': att['file_type'],
            'file_size': att['file_size'],
        })
    await db.commit()


async def find_by_message_ids(message_ids: list[int], db: AsyncSession) -> dict:
    """메시지 ID 목록에 해당하는 첨부파일 조회 → { message_id: [attachments] } dict 반환"""
    if not message_ids:
        return {}

    result = await db.execute(text("""
        SELECT attachment_id, message_id, file_url, file_name, file_type, file_size
        FROM chat_attachment
        WHERE message_id = ANY(:ids)
        ORDER BY attachment_id
    """), {'ids': message_ids})
    rows = result.fetchall()

    grouped = {}
    for row in rows:
        r = dict(row._mapping)
        mid = r['message_id']
        if mid not in grouped:
            grouped[mid] = []
        grouped[mid].append({
            'attachment_id': r['attachment_id'],
            'file_url': r['file_url'],
            'file_name': r['file_name'],
            'file_type': r['file_type'],
            'file_size': r['file_size'],
        })
    return grouped
