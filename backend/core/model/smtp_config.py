from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def get_config(db: AsyncSession):
    """활성 SMTP 설정 조회 (password 마스킹)"""
    result = await db.execute(text("""
        SELECT config_id, smtp_host, smtp_port, smtp_user, smtp_password,
               sender_email, sender_name, use_tls, is_active, updated_by, updated_at
        FROM smtp_config
        WHERE is_active = true
        ORDER BY config_id
        LIMIT 1
    """))
    row = result.fetchone()
    if not row:
        return None
    config = dict(row._mapping)
    # API 응답용 마스킹
    pw = config.get('smtp_password', '')
    if pw and len(pw) > 4:
        config['smtp_password'] = '****' + pw[-4:]
    elif pw:
        config['smtp_password'] = '****'
    return config


async def get_config_for_sending(db: AsyncSession):
    """이메일 발송용 SMTP 설정 조회 (password 포함)"""
    result = await db.execute(text("""
        SELECT config_id, smtp_host, smtp_port, smtp_user, smtp_password,
               sender_email, sender_name, use_tls
        FROM smtp_config
        WHERE is_active = true
        ORDER BY config_id
        LIMIT 1
    """))
    row = result.fetchone()
    if not row:
        return None
    return dict(row._mapping)


async def upsert_config(smtp_host: str, smtp_port: int, smtp_user: str,
                         smtp_password: str, sender_email: str, sender_name: str,
                         use_tls: bool, updated_by: int, db: AsyncSession) -> dict:
    """SMTP 설정 upsert"""
    existing = await get_config_for_sending(db)
    if existing:
        # password가 None이면 기존 값 유지
        actual_password = smtp_password if smtp_password else existing['smtp_password']
        result = await db.execute(text("""
            UPDATE smtp_config
            SET smtp_host = :smtp_host, smtp_port = :smtp_port, smtp_user = :smtp_user,
                smtp_password = :smtp_password, sender_email = :sender_email,
                sender_name = :sender_name, use_tls = :use_tls,
                updated_by = :updated_by, updated_at = NOW()
            WHERE config_id = :config_id
            RETURNING config_id, smtp_host, smtp_port, smtp_user, sender_email,
                      sender_name, use_tls, is_active, updated_by, updated_at
        """), {
            'smtp_host': smtp_host, 'smtp_port': smtp_port, 'smtp_user': smtp_user,
            'smtp_password': actual_password, 'sender_email': sender_email,
            'sender_name': sender_name, 'use_tls': use_tls,
            'updated_by': updated_by, 'config_id': existing['config_id'],
        })
    else:
        if not smtp_password:
            return None
        result = await db.execute(text("""
            INSERT INTO smtp_config (smtp_host, smtp_port, smtp_user, smtp_password,
                                      sender_email, sender_name, use_tls, updated_by)
            VALUES (:smtp_host, :smtp_port, :smtp_user, :smtp_password,
                    :sender_email, :sender_name, :use_tls, :updated_by)
            RETURNING config_id, smtp_host, smtp_port, smtp_user, sender_email,
                      sender_name, use_tls, is_active, updated_by, updated_at
        """), {
            'smtp_host': smtp_host, 'smtp_port': smtp_port, 'smtp_user': smtp_user,
            'smtp_password': smtp_password, 'sender_email': sender_email,
            'sender_name': sender_name, 'use_tls': use_tls, 'updated_by': updated_by,
        })
    await db.commit()
    row = result.fetchone()
    return dict(row._mapping)
