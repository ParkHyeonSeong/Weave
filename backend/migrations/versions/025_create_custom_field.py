"""create custom_field table and add custom_fields JSONB column to task

Revision ID: 025
Revises: 024
Create Date: 2026-03-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = '025'
down_revision: Union[str, None] = '024'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'custom_field',
        sa.Column('custom_field_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('branch_id', sa.Integer(), sa.ForeignKey('branch.branch_id', ondelete='CASCADE'), nullable=False),
        sa.Column('field_name', sa.String(100), nullable=False),
        sa.Column('field_type', sa.String(20), nullable=False),
        sa.Column('field_options', JSONB, nullable=True),
        sa.Column('is_required', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.UniqueConstraint('branch_id', 'field_name', name='uq_custom_field_branch_name'),
    )
    op.create_index('idx_custom_field_branch', 'custom_field', ['branch_id'])

    # task 테이블에 custom_fields JSONB 컬럼 추가
    op.add_column('task', sa.Column('custom_fields', JSONB, server_default='{}'))


def downgrade() -> None:
    op.drop_column('task', 'custom_fields')
    op.drop_index('idx_custom_field_branch', table_name='custom_field')
    op.drop_table('custom_field')
