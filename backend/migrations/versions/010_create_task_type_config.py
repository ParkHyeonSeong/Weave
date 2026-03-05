"""task_type_config 테이블 생성 + 기존 branch 시딩

Revision ID: 010
Revises: 009
Create Date: 2026-03-05
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '010'
down_revision: Union[str, None] = '009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # task_type_config 테이블
    op.create_table(
        'task_type_config',
        sa.Column('type_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('branch_id', sa.Integer(), sa.ForeignKey('branch.branch_id', ondelete='CASCADE'), nullable=False),
        sa.Column('type_key', sa.String(50), nullable=False),
        sa.Column('type_name', sa.String(100), nullable=False),
        sa.Column('icon', sa.String(50), nullable=False, server_default='CheckSquare'),
        sa.Column('color', sa.String(20), nullable=False, server_default='#5E6AD2'),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('branch_id', 'type_key', name='uq_task_type_branch_key'),
    )
    op.create_index('idx_task_type_config_branch', 'task_type_config', ['branch_id'])

    # 기존 branch들에 기본 타입 시딩
    op.execute("""
        INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
        SELECT b.branch_id, t.type_key, t.type_name, t.icon, t.color, t.sort_order
        FROM branch b
        CROSS JOIN (VALUES
            ('task',  'Task',  'CheckSquare', '#5E6AD2', 0),
            ('bug',   'Bug',   'Bug',         '#DC2626', 1),
            ('story', 'Story', 'BookOpen',    '#16A34A', 2)
        ) AS t(type_key, type_name, icon, color, sort_order)
    """)


def downgrade() -> None:
    op.drop_index('idx_task_type_config_branch', table_name='task_type_config')
    op.drop_table('task_type_config')
