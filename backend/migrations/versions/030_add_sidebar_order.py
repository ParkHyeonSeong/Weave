"""add sidebar_order JSONB column to user table

Revision ID: 030
Revises: 029
Create Date: 2026-03-10
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = '030'
down_revision: Union[str, None] = '029'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user', sa.Column('sidebar_order', JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column('user', 'sidebar_order')
