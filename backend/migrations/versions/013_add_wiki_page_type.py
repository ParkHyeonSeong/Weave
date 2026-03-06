"""add type column to wiki_page

Revision ID: 013
Revises: 012
Create Date: 2026-03-06
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '013'
down_revision: Union[str, None] = '012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # type: 'overview' (캔버스 소개), 'folder' (그룹), 'document' (문서)
    op.add_column('wiki_page', sa.Column(
        'type', sa.String(20), nullable=False, server_default='document'
    ))
    op.create_index('idx_wiki_page_type', 'wiki_page', ['type'])


def downgrade() -> None:
    op.drop_index('idx_wiki_page_type', table_name='wiki_page')
    op.drop_column('wiki_page', 'type')
