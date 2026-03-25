"""user 테이블에 must_change_password 컬럼 추가

Revision ID: 037
Revises: 036
Create Date: 2026-03-25
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '037'
down_revision: Union[str, None] = '036'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user', sa.Column(
        'must_change_password', sa.Boolean(), nullable=False, server_default='false',
    ))


def downgrade() -> None:
    op.drop_column('user', 'must_change_password')
