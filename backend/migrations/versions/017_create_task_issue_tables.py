"""task_issue, task_issue_comment 테이블 생성

Revision ID: 017
Revises: 016
Create Date: 2026-03-06
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '017'
down_revision: Union[str, None] = '016'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'task_issue',
        sa.Column('issue_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('task_id', sa.Integer(), sa.ForeignKey('task.task_id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('status', sa.String(10), nullable=False, server_default='open'),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('issue_id'),
        sa.CheckConstraint("status IN ('open', 'closed')", name='ck_task_issue_status'),
    )
    op.create_index('idx_task_issue_task', 'task_issue', ['task_id'])
    op.create_index('idx_task_issue_task_status', 'task_issue', ['task_id', 'status'])

    op.create_table(
        'task_issue_comment',
        sa.Column('comment_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('issue_id', sa.Integer(), sa.ForeignKey('task_issue.issue_id', ondelete='CASCADE'), nullable=False),
        sa.Column('author_id', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('comment_id'),
    )
    op.create_index('idx_task_issue_comment_issue', 'task_issue_comment', ['issue_id'])
    op.create_index('idx_task_issue_comment_issue_time', 'task_issue_comment', ['issue_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('idx_task_issue_comment_issue_time', table_name='task_issue_comment')
    op.drop_index('idx_task_issue_comment_issue', table_name='task_issue_comment')
    op.drop_table('task_issue_comment')

    op.drop_index('idx_task_issue_task_status', table_name='task_issue')
    op.drop_index('idx_task_issue_task', table_name='task_issue')
    op.drop_table('task_issue')
