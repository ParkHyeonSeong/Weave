"""create task_dependency table and epic.flow_positions column

Revision ID: 028
Revises: 027
Create Date: 2026-03-09
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '028'
down_revision: Union[str, None] = '027'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'task_dependency',
        sa.Column('dependency_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('branch_id', sa.Integer(), sa.ForeignKey('branch.branch_id', ondelete='CASCADE'), nullable=False),
        sa.Column('source_task_id', sa.Integer(), sa.ForeignKey('task.task_id', ondelete='CASCADE'), nullable=False),
        sa.Column('target_task_id', sa.Integer(), sa.ForeignKey('task.task_id', ondelete='CASCADE'), nullable=False),
        sa.Column('dep_type', sa.String(20), nullable=False, server_default='finish_to_start'),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('source_task_id', 'target_task_id', name='uq_task_dependency_pair'),
    )
    op.create_index('idx_dep_branch', 'task_dependency', ['branch_id'])
    op.create_index('idx_dep_source', 'task_dependency', ['source_task_id'])
    op.create_index('idx_dep_target', 'task_dependency', ['target_task_id'])

    op.add_column('epic', sa.Column('flow_positions', sa.JSON(), server_default=sa.text("'{}'::jsonb"), nullable=True))


def downgrade() -> None:
    op.drop_column('epic', 'flow_positions')
    op.drop_index('idx_dep_target', table_name='task_dependency')
    op.drop_index('idx_dep_source', table_name='task_dependency')
    op.drop_index('idx_dep_branch', table_name='task_dependency')
    op.drop_table('task_dependency')
