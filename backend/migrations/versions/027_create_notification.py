"""create notification table

Revision ID: 027
Revises: 026
Create Date: 2026-03-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '027'
down_revision: Union[str, None] = '026'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'notification',
        sa.Column('notification_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.user_id', ondelete='CASCADE'), nullable=False),
        sa.Column('type', sa.String(50), nullable=False),
        sa.Column('actor_id', sa.Integer(), sa.ForeignKey('user.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('link', sa.String(500), nullable=True),
        sa.Column('entity_type', sa.String(50), nullable=True),
        sa.Column('entity_id', sa.Integer(), nullable=True),
        sa.Column('is_read', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_notification_user_unread', 'notification', ['user_id', 'is_read', sa.text('created_at DESC')])
    op.create_index('idx_notification_user_created', 'notification', ['user_id', sa.text('created_at DESC')])


def downgrade() -> None:
    op.drop_index('idx_notification_user_created', table_name='notification')
    op.drop_index('idx_notification_user_unread', table_name='notification')
    op.drop_table('notification')
