"""create task_page_link table

Revision ID: 029
Revises: 028
Create Date: 2026-03-10
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '029'
down_revision: Union[str, None] = '028'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'task_page_link',
        sa.Column('link_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('task_id', sa.Integer(), sa.ForeignKey('task.task_id', ondelete='CASCADE'), nullable=False),
        sa.Column('page_id', sa.Integer(), sa.ForeignKey('canvas_page.page_id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('task_id', 'page_id', name='uq_task_page_link_pair'),
    )
    op.create_index('idx_tpl_task', 'task_page_link', ['task_id'])
    op.create_index('idx_tpl_page', 'task_page_link', ['page_id'])


def downgrade() -> None:
    op.drop_index('idx_tpl_page', table_name='task_page_link')
    op.drop_index('idx_tpl_task', table_name='task_page_link')
    op.drop_table('task_page_link')
