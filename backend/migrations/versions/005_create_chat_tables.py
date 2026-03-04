"""create chat_room, chat_room_member, chat_message tables

Revision ID: 005
Revises: 004
Create Date: 2026-03-04
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '005'
down_revision: Union[str, None] = '004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # chat_room 테이블
    op.create_table(
        'chat_room',
        sa.Column('room_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('room_type', sa.String(20), nullable=False, server_default='dm'),
        sa.Column('room_name', sa.String(200), nullable=True),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_chat_room_created_by', 'chat_room', ['created_by'])

    # chat_room_member 테이블
    op.create_table(
        'chat_room_member',
        sa.Column('room_id', sa.Integer(), sa.ForeignKey('chat_room.room_id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_read_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('room_id', 'user_id'),
    )
    op.create_index('idx_chat_room_member_user', 'chat_room_member', ['user_id'])

    # chat_message 테이블
    op.create_table(
        'chat_message',
        sa.Column('message_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('room_id', sa.Integer(), sa.ForeignKey('chat_room.room_id', ondelete='CASCADE'), nullable=False),
        sa.Column('sender_id', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_chat_message_room', 'chat_message', ['room_id'])
    op.create_index('idx_chat_message_room_created', 'chat_message', ['room_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('idx_chat_message_room_created', table_name='chat_message')
    op.drop_index('idx_chat_message_room', table_name='chat_message')
    op.drop_table('chat_message')
    op.drop_index('idx_chat_room_member_user', table_name='chat_room_member')
    op.drop_table('chat_room_member')
    op.drop_index('idx_chat_room_created_by', table_name='chat_room')
    op.drop_table('chat_room')
