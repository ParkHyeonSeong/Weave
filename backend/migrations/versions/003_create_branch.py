"""create branch and branch_member tables

Revision ID: 003
Revises: 002
Create Date: 2026-03-04
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '003'
down_revision: Union[str, None] = '002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # branch 테이블
    op.create_table(
        'branch',
        sa.Column('branch_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('branch_name', sa.String(200), nullable=False),
        sa.Column('slug', sa.String(100), nullable=False, unique=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('icon', sa.String(50), server_default='folder'),
        sa.Column('color', sa.String(20), server_default='#5E6AD2'),
        sa.Column('visibility', sa.String(20), nullable=False, server_default='private'),
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_branch_slug', 'branch', ['slug'])
    op.create_index('idx_branch_created_by', 'branch', ['created_by'])

    # branch_member 테이블
    op.create_table(
        'branch_member',
        sa.Column('branch_id', sa.Integer(), sa.ForeignKey('branch.branch_id'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('role', sa.String(20), nullable=False, server_default='member'),
        sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('branch_id', 'user_id'),
    )
    op.create_index('idx_branch_member_user', 'branch_member', ['user_id'])


def downgrade() -> None:
    op.drop_index('idx_branch_member_user', table_name='branch_member')
    op.drop_table('branch_member')
    op.drop_index('idx_branch_created_by', table_name='branch')
    op.drop_index('idx_branch_slug', table_name='branch')
    op.drop_table('branch')
