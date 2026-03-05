"""epic 테이블 생성

Revision ID: 008
Revises: 007
Create Date: 2026-03-05
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '008'
down_revision: Union[str, None] = '007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'epic',
        sa.Column('epic_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('branch_id', sa.Integer(), sa.ForeignKey('branch.branch_id', ondelete='CASCADE'), nullable=False),
        sa.Column('epic_name', sa.String(300), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='todo'),
        sa.Column('color', sa.String(20), nullable=False, server_default='#5E6AD2'),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('due_date', sa.Date(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_epic_branch', 'epic', ['branch_id'])


def downgrade() -> None:
    op.drop_index('idx_epic_branch', table_name='epic')
    op.drop_table('epic')
