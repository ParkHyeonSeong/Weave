"""create github_integration table (branch<->repo mapping + enable)

Revision ID: 058
Revises: 057
Create Date: 2026-06-26
"""
from typing import Sequence, Union
from alembic import op

revision: str = '058'
down_revision: Union[str, None] = '057'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE github_integration (
            integration_id   SERIAL PRIMARY KEY,
            branch_id        INTEGER NOT NULL REFERENCES branch(branch_id) ON DELETE CASCADE,
            repo_full_name   VARCHAR(300) NOT NULL,
            installation_id  BIGINT NOT NULL,
            enabled          BOOLEAN NOT NULL DEFAULT TRUE,
            created_by       INTEGER REFERENCES "user"(user_id),
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (branch_id, repo_full_name)
        )
    """)
    op.execute("CREATE INDEX idx_github_integration_branch ON github_integration(branch_id)")
    op.execute("CREATE INDEX idx_github_integration_repo ON github_integration(repo_full_name)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_github_integration_repo")
    op.execute("DROP INDEX IF EXISTS idx_github_integration_branch")
    op.execute("DROP TABLE IF EXISTS github_integration")
