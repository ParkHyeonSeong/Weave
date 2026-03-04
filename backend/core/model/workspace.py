from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def get_settings(db: AsyncSession):
    """워크스페이스 설정 조회 (초기화 여부 확인)"""
    result = await db.execute(text("""
        SELECT setting_id, workspace_name, registration_policy,
               initialized_at, initialized_by
        FROM workspace_settings
        WHERE setting_id = 1
    """))
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def create_settings(workspace_name: str, registration_policy: str,
                          admin_user_id: int, db: AsyncSession):
    """초기 워크스페이스 설정 생성 (최초 1회만 가능)"""
    await db.execute(text("""
        INSERT INTO workspace_settings (setting_id, workspace_name, registration_policy, initialized_by)
        VALUES (1, :workspace_name, :registration_policy, :admin_user_id)
    """), {
        'workspace_name': workspace_name,
        'registration_policy': registration_policy,
        'admin_user_id': admin_user_id,
    })
    await db.commit()
