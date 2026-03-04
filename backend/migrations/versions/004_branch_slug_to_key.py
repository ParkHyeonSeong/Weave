"""rename branch.slug to branch.key (uppercase project key)

Revision ID: 004
Revises: 003
Create Date: 2026-03-04
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '004'
down_revision: Union[str, None] = '003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # slug -> key 컬럼 이름 변경
    op.alter_column('branch', 'slug', new_column_name='key')

    # 인덱스 이름도 변경
    op.drop_index('idx_branch_slug', table_name='branch')
    op.create_index('idx_branch_key', 'branch', ['key'])


def downgrade() -> None:
    op.drop_index('idx_branch_key', table_name='branch')
    op.alter_column('branch', 'key', new_column_name='slug')
    op.create_index('idx_branch_slug', 'branch', ['slug'])
