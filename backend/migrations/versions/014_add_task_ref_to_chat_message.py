"""add task_id to chat_message

Revision ID: 014
Revises: 013
Create Date: 2026-03-06
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '014'
down_revision: Union[str, None] = '013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('chat_message', sa.Column(
        'task_id', sa.Integer(),
        sa.ForeignKey('task.task_id', ondelete='SET NULL'),
        nullable=True
    ))
    op.create_index('idx_chat_message_task', 'chat_message', ['task_id'])


def downgrade() -> None:
    op.drop_index('idx_chat_message_task', table_name='chat_message')
    op.drop_column('chat_message', 'task_id')
