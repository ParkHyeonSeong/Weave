"""create saved_view table (Phase 2 Saved Views)

Revision ID: 055
Revises: 054
Create Date: 2026-06-23
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = '055'
down_revision: Union[str, None] = '054'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'saved_view',
        sa.Column('view_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('owner_user_id', sa.Integer(), sa.ForeignKey('user.user_id', ondelete='CASCADE'), nullable=False),
        sa.Column('scope_branch_id', sa.Integer(), sa.ForeignKey('branch.branch_id', ondelete='CASCADE'), nullable=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('filter_spec', JSONB, nullable=False, server_default='{}'),
        sa.Column('group_by', sa.String(50), nullable=True),
        sa.Column('sort', JSONB, nullable=True),
        sa.Column('columns', JSONB, nullable=True),
        sa.Column('visibility', sa.String(20), nullable=False, server_default='private'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_saved_view_owner', 'saved_view', ['owner_user_id'])
    op.create_index('idx_saved_view_branch', 'saved_view', ['scope_branch_id'])


def downgrade() -> None:
    op.drop_index('idx_saved_view_branch', table_name='saved_view')
    op.drop_index('idx_saved_view_owner', table_name='saved_view')
    op.drop_table('saved_view')
