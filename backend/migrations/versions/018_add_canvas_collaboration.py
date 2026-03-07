"""add yjs_state column for real-time collaboration

Revision ID: 018
Revises: 017
Create Date: 2026-03-07
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '018'
down_revision: Union[str, None] = '017'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('canvas_page', sa.Column(
        'yjs_state', sa.LargeBinary(), nullable=True
    ))
    op.add_column('canvas_page', sa.Column(
        'yjs_updated_at', sa.DateTime(timezone=True), nullable=True
    ))


def downgrade() -> None:
    op.drop_column('canvas_page', 'yjs_updated_at')
    op.drop_column('canvas_page', 'yjs_state')
