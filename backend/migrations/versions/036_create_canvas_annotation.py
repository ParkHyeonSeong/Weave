"""canvas_annotation, canvas_annotation_reply 테이블 생성

Revision ID: 036
Revises: 035
Create Date: 2026-03-23
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '036'
down_revision: Union[str, None] = '035'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'canvas_annotation',
        sa.Column('annotation_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('page_id', sa.Integer(), sa.ForeignKey('canvas_page.page_id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('quoted_text', sa.Text(), nullable=False),
        sa.Column('prefix_context', sa.String(100), nullable=False, server_default=''),
        sa.Column('suffix_context', sa.String(100), nullable=False, server_default=''),
        sa.Column('anchor_node_path', sa.Text(), nullable=False, server_default=''),
        sa.Column('anchor_offset', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('anchor_length', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('status', sa.String(10), nullable=False, server_default='open'),
        sa.Column('resolved_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('annotation_id'),
        sa.CheckConstraint("status IN ('open', 'resolved')", name='ck_annotation_status'),
    )
    op.create_index('idx_annotation_page', 'canvas_annotation', ['page_id'])
    op.create_index('idx_annotation_page_status', 'canvas_annotation', ['page_id', 'status'])

    op.create_table(
        'canvas_annotation_reply',
        sa.Column('reply_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('annotation_id', sa.Integer(), sa.ForeignKey('canvas_annotation.annotation_id', ondelete='CASCADE'), nullable=False),
        sa.Column('author_id', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('reply_id'),
    )
    op.create_index('idx_annotation_reply_annotation', 'canvas_annotation_reply', ['annotation_id'])
    op.create_index('idx_annotation_reply_time', 'canvas_annotation_reply', ['annotation_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('idx_annotation_reply_time', table_name='canvas_annotation_reply')
    op.drop_index('idx_annotation_reply_annotation', table_name='canvas_annotation_reply')
    op.drop_table('canvas_annotation_reply')

    op.drop_index('idx_annotation_page_status', table_name='canvas_annotation')
    op.drop_index('idx_annotation_page', table_name='canvas_annotation')
    op.drop_table('canvas_annotation')
