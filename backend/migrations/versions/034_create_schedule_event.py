"""create schedule_event table

Revision ID: 034
Revises: 033
Create Date: 2026-03-13
"""
from typing import Sequence, Union
from alembic import op

revision: str = '034'
down_revision: Union[str, None] = '033'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE schedule_event (
            schedule_event_id SERIAL PRIMARY KEY,
            branch_id INTEGER NOT NULL REFERENCES branch(branch_id) ON DELETE CASCADE,
            title VARCHAR(200) NOT NULL,
            description TEXT,
            start_date DATE NOT NULL,
            end_date DATE,
            color VARCHAR(7) DEFAULT '#5E6AD2',
            created_by INTEGER NOT NULL REFERENCES "user"(user_id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX idx_schedule_event_branch ON schedule_event(branch_id)")
    op.execute("CREATE INDEX idx_schedule_event_dates ON schedule_event(branch_id, start_date, end_date)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS schedule_event")
