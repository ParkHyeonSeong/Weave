"""setup wizard: workspace_settings table + user role column

Revision ID: 002
Revises: 001
Create Date: 2026-03-04
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # user 테이블에 role 컬럼 추가
    op.add_column('user', sa.Column('role', sa.String(20), nullable=False, server_default='member'))

    # workspace_settings 테이블 생성
    op.create_table(
        'workspace_settings',
        sa.Column('setting_id', sa.Integer(), primary_key=True, server_default='1'),
        sa.Column('workspace_name', sa.String(200), nullable=False),
        sa.Column('registration_policy', sa.String(20), nullable=False, server_default='private'),
        sa.Column('initialized_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('initialized_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.CheckConstraint('setting_id = 1', name='single_row'),
    )


def downgrade() -> None:
    op.drop_table('workspace_settings')
    op.drop_column('user', 'role')
