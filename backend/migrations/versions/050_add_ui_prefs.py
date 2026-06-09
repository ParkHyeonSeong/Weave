"""add user.ui_prefs and migrate sidebar_order into it

Revision ID: 050
Revises: 049
Create Date: 2026-06-09

per-user 뷰 상태(사이드바 순서·숨김·런치패드·위젯)를 단일 ui_prefs JSONB로 통합.
기존 sidebar_order 컬럼 데이터를 ui_prefs.sidebar_order로 이전 후 컬럼 드롭.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = '050'
down_revision: Union[str, None] = '049'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user', sa.Column('ui_prefs', JSONB, nullable=True))
    # 기존 sidebar_order 데이터를 ui_prefs.sidebar_order로 이전
    op.execute("""
        UPDATE "user"
        SET ui_prefs = jsonb_build_object('sidebar_order', COALESCE(sidebar_order, '{}'::jsonb))
        WHERE sidebar_order IS NOT NULL
    """)
    op.drop_column('user', 'sidebar_order')


def downgrade() -> None:
    op.add_column('user', sa.Column('sidebar_order', JSONB, nullable=True))
    op.execute("""
        UPDATE "user"
        SET sidebar_order = ui_prefs->'sidebar_order'
        WHERE ui_prefs ? 'sidebar_order'
    """)
    op.drop_column('user', 'ui_prefs')
