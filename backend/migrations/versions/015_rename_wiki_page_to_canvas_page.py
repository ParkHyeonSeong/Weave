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
    # 012에서 이미 canvas_page로 생성되므로 no-op
    pass


def downgrade() -> None:
    pass
