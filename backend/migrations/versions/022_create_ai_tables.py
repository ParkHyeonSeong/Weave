"""create ai_config, ai_conversation, ai_message tables

Revision ID: 022
Revises: 021
Create Date: 2026-03-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '022'
down_revision: Union[str, None] = '021'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ai_config',
        sa.Column('config_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('provider', sa.String(50), server_default='anthropic', nullable=False),
        sa.Column('api_key', sa.Text(), nullable=False),
        sa.Column('model', sa.String(100), server_default='claude-sonnet-4-20250514', nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('updated_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
    )

    op.create_table(
        'ai_conversation',
        sa.Column('conversation_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('title', sa.String(200), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
    )
    op.create_index('ix_ai_conversation_user_id', 'ai_conversation', ['user_id'])

    op.create_table(
        'ai_message',
        sa.Column('message_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('conversation_id', sa.Integer(),
                  sa.ForeignKey('ai_conversation.conversation_id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(20), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('is_pinned', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
    )
    op.create_index('ix_ai_message_conversation_id', 'ai_message', ['conversation_id'])


def downgrade() -> None:
    op.drop_index('ix_ai_message_conversation_id', table_name='ai_message')
    op.drop_table('ai_message')
    op.drop_index('ix_ai_conversation_user_id', table_name='ai_conversation')
    op.drop_table('ai_conversation')
    op.drop_table('ai_config')
