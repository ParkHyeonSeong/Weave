"""rename wiki_page table to canvas_page

Revision ID: 015
Revises: 014
Create Date: 2026-03-06
"""
from typing import Sequence, Union
from alembic import op

revision: str = '015'
down_revision: Union[str, None] = '014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 인덱스 먼저 삭제
    op.drop_index('idx_wiki_page_canvas', table_name='wiki_page')
    op.drop_index('idx_wiki_page_parent', table_name='wiki_page')
    op.drop_index('idx_wiki_page_type', table_name='wiki_page')

    # 테이블명 변경
    op.rename_table('wiki_page', 'canvas_page')

    # 인덱스 재생성
    op.create_index('idx_canvas_page_canvas', 'canvas_page', ['canvas_id'])
    op.create_index('idx_canvas_page_parent', 'canvas_page', ['parent_page_id'])
    op.create_index('idx_canvas_page_type', 'canvas_page', ['type'])


def downgrade() -> None:
    op.drop_index('idx_canvas_page_type', table_name='canvas_page')
    op.drop_index('idx_canvas_page_parent', table_name='canvas_page')
    op.drop_index('idx_canvas_page_canvas', table_name='canvas_page')

    op.rename_table('canvas_page', 'wiki_page')

    op.create_index('idx_wiki_page_canvas', 'wiki_page', ['canvas_id'])
    op.create_index('idx_wiki_page_parent', 'wiki_page', ['parent_page_id'])
    op.create_index('idx_wiki_page_type', 'wiki_page', ['type'])
