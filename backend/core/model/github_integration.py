from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_COLS = (
    "integration_id, branch_id, repo_full_name, installation_id, "
    "enabled, created_by, created_at"
)


async def create(branch_id: int, repo_full_name: str, installation_id: int,
                 created_by: int, db: AsyncSession) -> dict:
    """브랜치-레포 연결 생성."""
    result = await db.execute(text(f"""
        INSERT INTO github_integration (branch_id, repo_full_name, installation_id, created_by)
        VALUES (:branch_id, :repo_full_name, :installation_id, :created_by)
        RETURNING {_COLS}
    """), {
        'branch_id': branch_id,
        'repo_full_name': repo_full_name,
        'installation_id': installation_id,
        'created_by': created_by,
    })
    return dict(result.fetchone()._mapping)


async def find_by_branch(branch_id: int, db: AsyncSession) -> list:
    """브랜치의 연결 목록 (활성/비활성 모두 — 설정 화면용)."""
    result = await db.execute(text(f"""
        SELECT {_COLS} FROM github_integration
        WHERE branch_id = :branch_id
        ORDER BY created_at
    """), {'branch_id': branch_id})
    return [dict(row._mapping) for row in result.fetchall()]


async def find_active_for_repo(repo_full_name: str, db: AsyncSession) -> list:
    """이 레포에 연결된 활성 브랜치 연결 목록 (웹훅 출처 매칭용). repo는 대소문자 무시."""
    result = await db.execute(text(f"""
        SELECT {_COLS} FROM github_integration
        WHERE LOWER(repo_full_name) = LOWER(:repo_full_name)
          AND enabled = TRUE
    """), {'repo_full_name': repo_full_name})
    return [dict(row._mapping) for row in result.fetchall()]


async def find_enabled(branch_id: int, repo_full_name: str, db: AsyncSession):
    """특정 브랜치+레포의 활성 연결 1건 (없으면 None). repo는 대소문자 무시."""
    result = await db.execute(text(f"""
        SELECT {_COLS} FROM github_integration
        WHERE branch_id = :branch_id
          AND LOWER(repo_full_name) = LOWER(:repo_full_name)
          AND enabled = TRUE
        LIMIT 1
    """), {'branch_id': branch_id, 'repo_full_name': repo_full_name})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def set_enabled(integration_id: int, branch_id: int, enabled: bool,
                      db: AsyncSession):
    """활성/비활성 토글. branch_id 튜플 스코프 — 타 브랜치 행은 건드리지 않음(None)."""
    result = await db.execute(text(f"""
        UPDATE github_integration SET enabled = :enabled
        WHERE integration_id = :integration_id AND branch_id = :branch_id
        RETURNING {_COLS}
    """), {'integration_id': integration_id, 'branch_id': branch_id, 'enabled': enabled})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def delete(integration_id: int, branch_id: int, db: AsyncSession):
    """연결 삭제. branch_id 튜플 스코프 + RETURNING — 타 브랜치 행이면 None."""
    result = await db.execute(text("""
        DELETE FROM github_integration
        WHERE integration_id = :integration_id AND branch_id = :branch_id
        RETURNING integration_id
    """), {'integration_id': integration_id, 'branch_id': branch_id})
    row = result.fetchone()
    return row[0] if row else None
