"""create task_github_ref table (task<->PR/commit link, tuple-scoped)

Revision ID: 059
Revises: 058
Create Date: 2026-06-26
"""
from typing import Sequence, Union
from alembic import op

revision: str = '059'
down_revision: Union[str, None] = '058'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE task_github_ref (
            ref_id          SERIAL PRIMARY KEY,
            task_id         INTEGER NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,
            repo_full_name  VARCHAR(300) NOT NULL,
            ref_type        VARCHAR(20) NOT NULL,
            ref_number      INTEGER,
            sha             VARCHAR(40),
            title           VARCHAR(500),
            state           VARCHAR(20),
            html_url        TEXT NOT NULL,
            linked_by       INTEGER REFERENCES "user"(user_id),
            linked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_synced_at  TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX idx_tgr_task ON task_github_ref(task_id)")
    # PR와 commit은 식별 키가 달라 단일 복합 UNIQUE가 아니라 PARTIAL UNIQUE 2개를 만든다.
    # 이 둘이 upsert_pr / commit upsert의 ON CONFLICT 추론 타깃(uq_tgr_pr / uq_tgr_commit)이다.
    op.execute("CREATE UNIQUE INDEX uq_tgr_pr ON task_github_ref (task_id, repo_full_name, ref_number) WHERE ref_type = 'pull_request'")
    op.execute("CREATE UNIQUE INDEX uq_tgr_commit ON task_github_ref (task_id, repo_full_name, sha) WHERE ref_type = 'commit'")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_tgr_commit")
    op.execute("DROP INDEX IF EXISTS uq_tgr_pr")
    op.execute("DROP INDEX IF EXISTS idx_tgr_task")
    op.execute("DROP TABLE IF EXISTS task_github_ref")
