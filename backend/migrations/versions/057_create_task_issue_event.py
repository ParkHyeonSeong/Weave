"""task_issue_event 테이블 생성 (close/reopen 타임라인 이벤트)

Revision ID: 057
Revises: 056
Create Date: 2026-06-26
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '057'
down_revision: Union[str, None] = '056'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'task_issue_event',
        sa.Column('event_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('issue_id', sa.Integer(), sa.ForeignKey('task_issue.issue_id', ondelete='CASCADE'), nullable=False),
        sa.Column('actor_id', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('event_type', sa.String(20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('event_id'),
        sa.CheckConstraint("event_type IN ('closed', 'reopened')", name='ck_task_issue_event_type'),
    )
    op.create_index('idx_task_issue_event_issue_time', 'task_issue_event', ['issue_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('idx_task_issue_event_issue_time', table_name='task_issue_event')
    op.drop_table('task_issue_event')
