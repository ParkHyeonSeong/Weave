"""create workflow_status table for custom workflow per branch

Revision ID: 024
Revises: 023
Create Date: 2026-03-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '024'
down_revision: Union[str, None] = '023'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'workflow_status',
        sa.Column('workflow_status_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('branch_id', sa.Integer(), sa.ForeignKey('branch.branch_id', ondelete='CASCADE'), nullable=False),
        sa.Column('key', sa.String(50), nullable=False),
        sa.Column('label', sa.String(50), nullable=False),
        sa.Column('color', sa.String(7), nullable=False, server_default='#9CA3AF'),
        sa.Column('category', sa.String(20), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default='false'),
        sa.UniqueConstraint('branch_id', 'key', name='uq_workflow_status_branch_key'),
    )
    op.create_index('idx_workflow_status_branch', 'workflow_status', ['branch_id'])

    # 기존 모든 branch에 대해 기본 3개 상태 시딩
    op.execute("""
        INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order, is_default)
        SELECT branch_id, 'todo', 'To Do', '#9CA3AF', 'todo', 0, TRUE FROM branch
        WHERE is_archived = FALSE
        UNION ALL
        SELECT branch_id, 'in_progress', 'In Progress', '#2563EB', 'in_progress', 1, FALSE FROM branch
        WHERE is_archived = FALSE
        UNION ALL
        SELECT branch_id, 'done', 'Done', '#16A34A', 'done', 2, FALSE FROM branch
        WHERE is_archived = FALSE
    """)


def downgrade() -> None:
    op.drop_index('idx_workflow_status_branch', table_name='workflow_status')
    op.drop_table('workflow_status')
