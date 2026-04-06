"""create activity_log table for change history tracking

Revision ID: 042
Revises: 041
Create Date: 2026-04-06
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = '042'
down_revision: Union[str, None] = '041'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'activity_log',
        sa.Column('log_id', sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column('entity_type', sa.String(30), nullable=False),
        sa.Column('entity_id', sa.Integer, nullable=False),
        sa.Column('branch_id', sa.Integer, sa.ForeignKey('branch.branch_id', ondelete='CASCADE'), nullable=True),
        sa.Column('canvas_id', sa.Integer, sa.ForeignKey('canvas.canvas_id', ondelete='CASCADE'), nullable=True),
        sa.Column('actor_id', sa.Integer, sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('action', sa.String(30), nullable=False),
        sa.Column('changes', JSONB, nullable=False, server_default='[]'),
        sa.Column('summary', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
    )

    op.create_index('idx_activity_entity', 'activity_log',
                     ['entity_type', 'entity_id', sa.text('created_at DESC')])
    op.create_index('idx_activity_branch', 'activity_log',
                     ['branch_id', sa.text('created_at DESC')],
                     postgresql_where=sa.text('branch_id IS NOT NULL'))
    op.create_index('idx_activity_canvas', 'activity_log',
                     ['canvas_id', sa.text('created_at DESC')],
                     postgresql_where=sa.text('canvas_id IS NOT NULL'))


def downgrade() -> None:
    op.drop_index('idx_activity_canvas', table_name='activity_log')
    op.drop_index('idx_activity_branch', table_name='activity_log')
    op.drop_index('idx_activity_entity', table_name='activity_log')
    op.drop_table('activity_log')
