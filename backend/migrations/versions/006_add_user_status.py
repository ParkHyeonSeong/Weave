"""add status column to user table

Revision ID: 006
Revises: 005
Create Date: 2026-03-05
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '006'
down_revision: Union[str, None] = '005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # status 컬럼 추가 (기존 사용자는 모두 'active')
    op.add_column('user', sa.Column('status', sa.String(20), nullable=False, server_default='active'))


def downgrade() -> None:
    op.drop_column('user', 'status')
