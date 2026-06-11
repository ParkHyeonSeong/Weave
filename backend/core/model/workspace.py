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
                          admin_user_id: int, db: AsyncSession) -> bool:
    """초기 워크스페이스 설정 생성 (최초 1회만 가능).

    workspace_settings는 setting_id=1 단일행 싱글톤(PK + CHECK setting_id=1).
    동시 요청이 둘 다 "미초기화"로 통과해도, 두 번째 INSERT는 PK 충돌로 자연히
    무효화된다(ON CONFLICT DO NOTHING). 실제로 행을 삽입한 요청만 True를 받아
    관리자/워크스페이스의 단일 소유권을 보장한다(TOCTOU 경합 가드).

    Returns:
        True  -- 이 호출이 설정 행을 실제로 삽입함(초기화 성공)
        False -- 이미 설정이 존재해 삽입되지 않음(경합에서 진 쪽)
    """
    result = await db.execute(text("""
        INSERT INTO workspace_settings (setting_id, workspace_name, registration_policy, initialized_by)
        VALUES (1, :workspace_name, :registration_policy, :admin_user_id)
        ON CONFLICT (setting_id) DO NOTHING
    """), {
        'workspace_name': workspace_name,
        'registration_policy': registration_policy,
        'admin_user_id': admin_user_id,
    })
    return result.rowcount == 1
