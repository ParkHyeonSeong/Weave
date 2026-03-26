"""add deleted_at to user table for soft delete

Revision ID: 041
Revises: 040
Create Date: 2026-03-26
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '041'
down_revision: Union[str, None] = '040'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('user', 'deleted_at')
