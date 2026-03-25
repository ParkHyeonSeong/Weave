"""create schedule_event_participant table

Revision ID: 039
Revises: 038
Create Date: 2026-03-25
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '039'
down_revision: Union[str, None] = '038'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'schedule_event_participant',
        sa.Column('schedule_event_id', sa.Integer(), sa.ForeignKey('schedule_event.schedule_event_id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.user_id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('schedule_event_id', 'user_id'),
    )
    op.create_index('idx_sep_event', 'schedule_event_participant', ['schedule_event_id'])
    op.create_index('idx_sep_user', 'schedule_event_participant', ['user_id'])


def downgrade() -> None:
    op.drop_index('idx_sep_user', table_name='schedule_event_participant')
    op.drop_index('idx_sep_event', table_name='schedule_event_participant')
    op.drop_table('schedule_event_participant')
