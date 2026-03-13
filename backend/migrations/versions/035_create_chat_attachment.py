"""create chat_attachment table

Revision ID: 035
Revises: 034
Create Date: 2026-03-13
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '035'
down_revision: Union[str, None] = '034'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'chat_attachment',
        sa.Column('attachment_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('message_id', sa.Integer(),
                  sa.ForeignKey('chat_message.message_id', ondelete='CASCADE'), nullable=False),
        sa.Column('file_url', sa.Text(), nullable=False),
        sa.Column('file_name', sa.String(500), nullable=False),
        sa.Column('file_type', sa.String(100), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_chat_attachment_message', 'chat_attachment', ['message_id'])


def downgrade() -> None:
    op.drop_index('idx_chat_attachment_message', table_name='chat_attachment')
    op.drop_table('chat_attachment')
