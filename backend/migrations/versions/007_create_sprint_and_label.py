"""sprint, label 테이블 생성

Revision ID: 007
Revises: 006
Create Date: 2026-03-05
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '007'
down_revision: Union[str, None] = '006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # sprint 테이블
    op.create_table(
        'sprint',
        sa.Column('sprint_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('branch_id', sa.Integer(), sa.ForeignKey('branch.branch_id', ondelete='CASCADE'), nullable=False),
        sa.Column('sprint_name', sa.String(200), nullable=False),
        sa.Column('goal', sa.Text(), nullable=True),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='future'),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_sprint_branch', 'sprint', ['branch_id'])
    op.create_index('idx_sprint_branch_status', 'sprint', ['branch_id', 'status'])

    # label 테이블
    op.create_table(
        'label',
        sa.Column('label_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('branch_id', sa.Integer(), sa.ForeignKey('branch.branch_id', ondelete='CASCADE'), nullable=False),
        sa.Column('label_name', sa.String(100), nullable=False),
        sa.Column('color', sa.String(20), nullable=False, server_default='#5E6AD2'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('branch_id', 'label_name', name='uq_label_branch_name'),
    )
    op.create_index('idx_label_branch', 'label', ['branch_id'])


def downgrade() -> None:
    op.drop_index('idx_label_branch', table_name='label')
    op.drop_table('label')
    op.drop_index('idx_sprint_branch_status', table_name='sprint')
    op.drop_index('idx_sprint_branch', table_name='sprint')
    op.drop_table('sprint')
