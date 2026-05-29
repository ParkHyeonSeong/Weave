"""create task_comment tables

Revision ID: 047
Revises: 046
Create Date: 2026-05-28

task_comment + task_comment_mention.
- Reply depth enforced at application layer (controller normalizes parent_comment_id to root).
- Soft delete via deleted_at; mention table preserved across soft delete (audit).
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '047'
down_revision: Union[str, None] = '046'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'task_comment',
        sa.Column('comment_id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('task_id', sa.BigInteger(),
                  sa.ForeignKey('task.task_id', ondelete='CASCADE'), nullable=False),
        sa.Column('parent_comment_id', sa.BigInteger(),
                  sa.ForeignKey('task_comment.comment_id'), nullable=True),
        sa.Column('author_id', sa.BigInteger(),
                  sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('is_edited', sa.Boolean(), nullable=False, server_default=sa.text('FALSE')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        'idx_task_comment_task',
        'task_comment',
        ['task_id', 'created_at'],
        postgresql_where=sa.text('deleted_at IS NULL'),
    )
    op.create_index(
        'idx_task_comment_parent',
        'task_comment',
        ['parent_comment_id'],
        postgresql_where=sa.text('parent_comment_id IS NOT NULL'),
    )

    op.create_table(
        'task_comment_mention',
        sa.Column('comment_id', sa.BigInteger(),
                  sa.ForeignKey('task_comment.comment_id', ondelete='CASCADE'),
                  primary_key=True),
        sa.Column('user_id', sa.BigInteger(),
                  sa.ForeignKey('user.user_id'),
                  primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('idx_task_comment_mention_user', 'task_comment_mention', ['user_id'])


def downgrade() -> None:
    op.drop_index('idx_task_comment_mention_user', table_name='task_comment_mention')
    op.drop_table('task_comment_mention')
    op.drop_index('idx_task_comment_parent', table_name='task_comment')
    op.drop_index('idx_task_comment_task', table_name='task_comment')
    op.drop_table('task_comment')
