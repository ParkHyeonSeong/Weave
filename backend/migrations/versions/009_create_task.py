"""task, task_sequence, task_label 테이블 생성

Revision ID: 009
Revises: 008
Create Date: 2026-03-05
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '009'
down_revision: Union[str, None] = '008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # task_sequence: Branch별 자동 증가 번호
    op.create_table(
        'task_sequence',
        sa.Column('branch_id', sa.Integer(), sa.ForeignKey('branch.branch_id', ondelete='CASCADE'), primary_key=True),
        sa.Column('last_number', sa.Integer(), nullable=False, server_default='0'),
    )

    # task 테이블
    op.create_table(
        'task',
        sa.Column('task_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('branch_id', sa.Integer(), sa.ForeignKey('branch.branch_id', ondelete='CASCADE'), nullable=False),
        sa.Column('display_number', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('task_type', sa.String(20), nullable=False, server_default='task'),
        sa.Column('status', sa.String(20), nullable=False, server_default='todo'),
        sa.Column('priority', sa.String(20), nullable=False, server_default='medium'),
        sa.Column('epic_id', sa.Integer(), sa.ForeignKey('epic.epic_id', ondelete='SET NULL'), nullable=True),
        sa.Column('sprint_id', sa.Integer(), sa.ForeignKey('sprint.sprint_id', ondelete='SET NULL'), nullable=True),
        sa.Column('parent_task_id', sa.Integer(), sa.ForeignKey('task.task_id', ondelete='CASCADE'), nullable=True),
        sa.Column('assignee_id', sa.Integer(), sa.ForeignKey('user.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('due_date', sa.Date(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('branch_id', 'display_number', name='uq_task_branch_display'),
    )
    op.create_index('idx_task_branch', 'task', ['branch_id'])
    op.create_index('idx_task_branch_sprint', 'task', ['branch_id', 'sprint_id'])
    op.create_index('idx_task_branch_epic', 'task', ['branch_id', 'epic_id'])
    op.create_index('idx_task_assignee', 'task', ['assignee_id'])
    op.create_index('idx_task_parent', 'task', ['parent_task_id'])

    # task_label 다대다 테이블
    op.create_table(
        'task_label',
        sa.Column('task_id', sa.Integer(), sa.ForeignKey('task.task_id', ondelete='CASCADE'), nullable=False),
        sa.Column('label_id', sa.Integer(), sa.ForeignKey('label.label_id', ondelete='CASCADE'), nullable=False),
        sa.PrimaryKeyConstraint('task_id', 'label_id'),
    )
    op.create_index('idx_task_label_label', 'task_label', ['label_id'])


def downgrade() -> None:
    op.drop_index('idx_task_label_label', table_name='task_label')
    op.drop_table('task_label')
    op.drop_index('idx_task_parent', table_name='task')
    op.drop_index('idx_task_assignee', table_name='task')
    op.drop_index('idx_task_branch_epic', table_name='task')
    op.drop_index('idx_task_branch_sprint', table_name='task')
    op.drop_index('idx_task_branch', table_name='task')
    op.drop_table('task')
    op.drop_table('task_sequence')
