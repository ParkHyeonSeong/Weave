"""create push_subscription table

Revision ID: 033
Revises: 032
Create Date: 2026-03-12
"""
from typing import Sequence, Union
from alembic import op

revision: str = '033'
down_revision: Union[str, None] = '032'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE push_subscription (
            subscription_id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX idx_push_sub_user ON push_subscription(user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS push_subscription")
