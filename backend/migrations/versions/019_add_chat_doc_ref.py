"""add canvas_page_id to chat_message

Revision ID: 019
Revises: 018
Create Date: 2026-03-07
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '019'
down_revision: Union[str, None] = '018'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('chat_message', sa.Column(
        'canvas_page_id', sa.Integer(),
        sa.ForeignKey('canvas_page.page_id', ondelete='SET NULL'),
        nullable=True
    ))
    op.create_index('idx_chat_message_canvas_page', 'chat_message', ['canvas_page_id'])


def downgrade() -> None:
    op.drop_index('idx_chat_message_canvas_page', table_name='chat_message')
    op.drop_column('chat_message', 'canvas_page_id')
