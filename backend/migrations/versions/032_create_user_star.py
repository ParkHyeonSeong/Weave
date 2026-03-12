"""create user_star table

Revision ID: 032
Revises: 031
Create Date: 2026-03-12
"""
from typing import Sequence, Union
from alembic import op

revision: str = '032'
down_revision: Union[str, None] = '031'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE user_star (
            star_id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
            item_type VARCHAR(20) NOT NULL,
            item_id INTEGER NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    op.execute("CREATE UNIQUE INDEX idx_user_star_unique ON user_star(user_id, item_type, item_id)")
    op.execute("CREATE INDEX idx_user_star_user ON user_star(user_id, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_star")
