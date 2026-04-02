from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from library.crypto import encrypt, decrypt


# ── ai_config ────────────────────────────────────────────────────────────

async def get_config(db: AsyncSession):
    """활성 AI 설정 조회 (api_key 복호화 포함)"""
    result = await db.execute(text("""
        SELECT config_id, provider, api_key, model, is_active, updated_by, updated_at
        FROM ai_config
        WHERE is_active = true
        ORDER BY config_id
        LIMIT 1
    """))
    row = result.fetchone()
    if not row:
        return None
    data = dict(row._mapping)
    if data.get('api_key'):
        data['api_key'] = decrypt(data['api_key'])
    return data


async def upsert_config(provider: str, api_key: str, model: str,
                         updated_by: int, db: AsyncSession) -> dict:
    """AI 설정 upsert (있으면 업데이트, 없으면 삽입)"""
    existing = await get_config(db)
    if existing:
        result = await db.execute(text("""
            UPDATE ai_config
            SET provider = :provider, api_key = :api_key, model = :model,
                updated_by = :updated_by, updated_at = NOW()
            WHERE config_id = :config_id
            RETURNING config_id, provider, api_key, model, is_active, updated_by, updated_at
        """), {
            'provider': provider, 'api_key': encrypt(api_key), 'model': model,
            'updated_by': updated_by, 'config_id': existing['config_id'],
        })
    else:
        result = await db.execute(text("""
            INSERT INTO ai_config (provider, api_key, model, updated_by)
            VALUES (:provider, :api_key, :model, :updated_by)
            RETURNING config_id, provider, api_key, model, is_active, updated_by, updated_at
        """), {
            'provider': provider, 'api_key': encrypt(api_key), 'model': model,
            'updated_by': updated_by,
        })
    await db.commit()
    row = result.fetchone()
    return dict(row._mapping)


# ── ai_conversation ──────────────────────────────────────────────────────

async def create_conversation(user_id: int, title: str, db: AsyncSession) -> dict:
    """대화 생성"""
    result = await db.execute(text("""
        INSERT INTO ai_conversation (user_id, title)
        VALUES (:user_id, :title)
        RETURNING conversation_id, user_id, title, created_at, updated_at
    """), {'user_id': user_id, 'title': title})
    await db.commit()
    row = result.fetchone()
    return dict(row._mapping)


async def find_conversations_by_user(user_id: int, db: AsyncSession) -> list:
    """사용자의 대화 목록 (최근순)"""
    result = await db.execute(text("""
        SELECT conversation_id, user_id, title, created_at, updated_at
        FROM ai_conversation
        WHERE user_id = :user_id
        ORDER BY updated_at DESC
    """), {'user_id': user_id})
    return [dict(row._mapping) for row in result.fetchall()]


async def find_conversation_by_id(conversation_id: int, db: AsyncSession):
    """대화 상세 조회"""
    result = await db.execute(text("""
        SELECT conversation_id, user_id, title, created_at, updated_at
        FROM ai_conversation
        WHERE conversation_id = :conversation_id
    """), {'conversation_id': conversation_id})
    row = result.fetchone()
    if not row:
        return None
    return dict(row._mapping)


async def delete_conversation(conversation_id: int, user_id: int, db: AsyncSession) -> bool:
    """대화 삭제 (소유자만)"""
    result = await db.execute(text("""
        DELETE FROM ai_conversation
        WHERE conversation_id = :conversation_id AND user_id = :user_id
    """), {'conversation_id': conversation_id, 'user_id': user_id})
    await db.commit()
    return result.rowcount > 0


async def update_conversation_title(conversation_id: int, title: str, db: AsyncSession):
    """대화 제목 변경"""
    await db.execute(text("""
        UPDATE ai_conversation SET title = :title, updated_at = NOW()
        WHERE conversation_id = :conversation_id
    """), {'conversation_id': conversation_id, 'title': title})
    await db.commit()


async def update_conversation_timestamp(conversation_id: int, db: AsyncSession):
    """대화 updated_at 갱신"""
    await db.execute(text("""
        UPDATE ai_conversation SET updated_at = NOW()
        WHERE conversation_id = :conversation_id
    """), {'conversation_id': conversation_id})
    await db.commit()


# ── ai_message ───────────────────────────────────────────────────────────

async def create_message(conversation_id: int, role: str, content: str,
                          db: AsyncSession) -> dict:
    """메시지 생성"""
    result = await db.execute(text("""
        INSERT INTO ai_message (conversation_id, role, content)
        VALUES (:conversation_id, :role, :content)
        RETURNING message_id, conversation_id, role, content, is_pinned, created_at
    """), {'conversation_id': conversation_id, 'role': role, 'content': content})
    await db.commit()
    row = result.fetchone()
    return dict(row._mapping)


async def find_messages_by_conversation(conversation_id: int, db: AsyncSession) -> list:
    """대화의 메시지 목록 (시간순)"""
    result = await db.execute(text("""
        SELECT message_id, conversation_id, role, content, is_pinned, created_at
        FROM ai_message
        WHERE conversation_id = :conversation_id
        ORDER BY created_at ASC
    """), {'conversation_id': conversation_id})
    return [dict(row._mapping) for row in result.fetchall()]


async def toggle_pin(message_id: int, db: AsyncSession):
    """메시지 핀 토글"""
    result = await db.execute(text("""
        UPDATE ai_message SET is_pinned = NOT is_pinned
        WHERE message_id = :message_id
        RETURNING message_id, is_pinned
    """), {'message_id': message_id})
    await db.commit()
    row = result.fetchone()
    if not row:
        return None
    return dict(row._mapping)


async def find_pinned_messages(conversation_id: int, db: AsyncSession) -> list:
    """핀된 메시지 목록 (시간순)"""
    result = await db.execute(text("""
        SELECT message_id, conversation_id, role, content, is_pinned, created_at
        FROM ai_message
        WHERE conversation_id = :conversation_id AND is_pinned = true
        ORDER BY created_at ASC
    """), {'conversation_id': conversation_id})
    return [dict(row._mapping) for row in result.fetchall()]


async def find_message_by_id(message_id: int, db: AsyncSession):
    """메시지 단건 조회"""
    result = await db.execute(text("""
        SELECT m.message_id, m.conversation_id, m.role, m.content, m.is_pinned, m.created_at,
               c.user_id
        FROM ai_message m
        INNER JOIN ai_conversation c ON m.conversation_id = c.conversation_id
        WHERE m.message_id = :message_id
    """), {'message_id': message_id})
    row = result.fetchone()
    if not row:
        return None
    return dict(row._mapping)
