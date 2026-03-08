"""create recent_view table for tracking user's recently viewed items

Revision ID: 023
Revises: 022
Create Date: 2026-03-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '023'
down_revision: Union[str, None] = '022'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE recent_view (
            view_id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES "user"(user_id),
            item_type VARCHAR(20) NOT NULL,
            item_id INTEGER NOT NULL,
            viewed_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX idx_recent_view_user ON recent_view(user_id, viewed_at DESC)")
    op.execute("""
        CREATE UNIQUE INDEX idx_recent_view_unique
        ON recent_view(user_id, item_type, item_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS recent_view")
