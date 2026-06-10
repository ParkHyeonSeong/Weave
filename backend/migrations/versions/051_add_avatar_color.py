"""add avatar_color column to user table

Revision ID: 051
Revises: 050
Create Date: 2026-06-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '051'
down_revision: Union[str, None] = '050'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user', sa.Column('avatar_color', sa.String(7), nullable=True))


def downgrade() -> None:
    op.drop_column('user', 'avatar_color')
