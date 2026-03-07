"""add issue_id to chat_message

Revision ID: 020
Revises: 019
Create Date: 2026-03-07
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '020'
down_revision: Union[str, None] = '019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('chat_message', sa.Column(
        'issue_id', sa.Integer(),
        sa.ForeignKey('task_issue.issue_id', ondelete='SET NULL'),
        nullable=True
    ))
    op.create_index('idx_chat_message_issue', 'chat_message', ['issue_id'])


def downgrade() -> None:
    op.drop_index('idx_chat_message_issue', table_name='chat_message')
    op.drop_column('chat_message', 'issue_id')
