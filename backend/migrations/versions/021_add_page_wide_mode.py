"""add wide_mode column to canvas_page

Revision ID: 021
Revises: 020
Create Date: 2026-03-07
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '021'
down_revision: Union[str, None] = '020'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('canvas_page', sa.Column(
        'wide_mode', sa.Boolean(), server_default='false', nullable=False
    ))


def downgrade() -> None:
    op.drop_column('canvas_page', 'wide_mode')
