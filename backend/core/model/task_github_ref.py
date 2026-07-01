from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_COLS = (
    "ref_id, task_id, repo_full_name, ref_type, ref_number, sha, title, "
    "state, html_url, linked_by, linked_at, last_synced_at"
)


async def upsert_pr(task_id: int, repo_full_name: str, ref_number: int, sha,
                    title, state, html_url: str, linked_by, db: AsyncSession) -> dict:
    """PR 링크 upsert. (task_id, repo_full_name, ref_number) 부분유니크 키로 충돌 시
    state/title/url/last_synced_at만 갱신(linked_by/linked_at는 보존)."""
    result = await db.execute(text(f"""
        INSERT INTO task_github_ref
            (task_id, repo_full_name, ref_type, ref_number, sha, title, state,
             html_url, linked_by, last_synced_at)
        VALUES
            (:task_id, :repo_full_name, 'pull_request', :ref_number, :sha, :title,
             :state, :html_url, :linked_by, NOW())
        ON CONFLICT (task_id, repo_full_name, ref_number)
            WHERE ref_type = 'pull_request'
        DO UPDATE SET
            title = EXCLUDED.title,
            state = EXCLUDED.state,
            html_url = EXCLUDED.html_url,
            sha = EXCLUDED.sha,
            last_synced_at = NOW()
        RETURNING {_COLS}
    """), {
        'task_id': task_id,
        'repo_full_name': repo_full_name,
        'ref_number': ref_number,
        'sha': sha,
        'title': title,
        'state': state,
        'html_url': html_url,
        'linked_by': linked_by,
    })
    return dict(result.fetchone()._mapping)


async def create(task_id: int, repo_full_name: str, ref_type: str, ref_number,
                 sha, title, state, html_url: str, created_by: int,
                 db: AsyncSession) -> dict:
    """수동 ref 생성 (linked_by=수동 연결 유저)."""
    result = await db.execute(text(f"""
        INSERT INTO task_github_ref
            (task_id, repo_full_name, ref_type, ref_number, sha, title, state,
             html_url, linked_by, last_synced_at)
        VALUES
            (:task_id, :repo_full_name, :ref_type, :ref_number, :sha, :title,
             :state, :html_url, :created_by, NOW())
        RETURNING {_COLS}
    """), {
        'task_id': task_id,
        'repo_full_name': repo_full_name,
        'ref_type': ref_type,
        'ref_number': ref_number,
        'sha': sha,
        'title': title,
        'state': state,
        'html_url': html_url,
        'created_by': created_by,
    })
    return dict(result.fetchone()._mapping)


async def find_by_task(task_id: int, db: AsyncSession) -> list:
    """태스크에 연결된 PR/커밋 목록 (최신 연결 우선)."""
    result = await db.execute(text(f"""
        SELECT {_COLS} FROM task_github_ref
        WHERE task_id = :task_id
        ORDER BY linked_at DESC
    """), {'task_id': task_id})
    return [dict(row._mapping) for row in result.fetchall()]


async def delete(ref_id: int, task_id: int, db: AsyncSession):
    """ref 삭제. (ref_id, task_id) 튜플 스코프 + RETURNING — 타 task면 None."""
    result = await db.execute(text("""
        DELETE FROM task_github_ref
        WHERE ref_id = :ref_id AND task_id = :task_id
        RETURNING ref_id
    """), {'ref_id': ref_id, 'task_id': task_id})
    row = result.fetchone()
    return row[0] if row else None


async def count_active_prs(task_id: int, exclude_ref_id, db: AsyncSession) -> int:
    """이 task의 활성(open|merged) PR 링크 수 — exclude_ref_id 한 건 제외.
    exclude_ref_id=None이면 제외 없이 전체 활성 PR 수를 반환한다.
    머지 없이 닫힘 처리 시 '다른 활성 PR 없음' 게이트에 쓴다."""
    result = await db.execute(text("""
        SELECT COUNT(*) FROM task_github_ref
        WHERE task_id = :task_id
          AND ref_type = 'pull_request'
          AND state IN ('open', 'merged')
          AND (CAST(:exclude_ref_id AS BIGINT) IS NULL OR ref_id != :exclude_ref_id)
    """), {'task_id': task_id, 'exclude_ref_id': exclude_ref_id})
    return result.scalar_one()
