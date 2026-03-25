"""create schedule_event_task table

Revision ID: 038
Revises: 037
Create Date: 2026-03-25
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '038'
down_revision: Union[str, None] = '037'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'schedule_event_task',
        sa.Column('link_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('schedule_event_id', sa.Integer(), sa.ForeignKey('schedule_event.schedule_event_id', ondelete='CASCADE'), nullable=False),
        sa.Column('task_id', sa.Integer(), sa.ForeignKey('task.task_id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('schedule_event_id', 'task_id', name='uq_schedule_event_task_pair'),
    )
    op.create_index('idx_set_event', 'schedule_event_task', ['schedule_event_id'])
    op.create_index('idx_set_task', 'schedule_event_task', ['task_id'])


def downgrade() -> None:
    op.drop_index('idx_set_task', table_name='schedule_event_task')
    op.drop_index('idx_set_event', table_name='schedule_event_task')
    op.drop_table('schedule_event_task')
