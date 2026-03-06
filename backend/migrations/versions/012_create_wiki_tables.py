"""create canvas, canvas_member, wiki_page tables

Revision ID: 012
Revises: 011
Create Date: 2026-03-06
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '012'
down_revision: Union[str, None] = '011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # canvas 테이블
    op.create_table(
        'canvas',
        sa.Column('canvas_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('canvas_name', sa.String(200), nullable=False),
        sa.Column('key', sa.String(10), nullable=False, unique=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('icon', sa.String(50), server_default='book-open'),
        sa.Column('color', sa.String(20), server_default='#16A34A'),
        sa.Column('visibility', sa.String(20), nullable=False, server_default='private'),
        sa.Column('branch_id', sa.Integer(), sa.ForeignKey('branch.branch_id'), nullable=True),
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_canvas_key', 'canvas', ['key'])
    op.create_index('idx_canvas_created_by', 'canvas', ['created_by'])
    op.create_index('idx_canvas_branch', 'canvas', ['branch_id'])

    # canvas_member 테이블
    op.create_table(
        'canvas_member',
        sa.Column('canvas_id', sa.Integer(), sa.ForeignKey('canvas.canvas_id'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('role', sa.String(20), nullable=False, server_default='member'),
        sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('canvas_id', 'user_id'),
    )
    op.create_index('idx_canvas_member_user', 'canvas_member', ['user_id'])

    # wiki_page 테이블
    op.create_table(
        'wiki_page',
        sa.Column('page_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('canvas_id', sa.Integer(), sa.ForeignKey('canvas.canvas_id'), nullable=False),
        sa.Column('parent_page_id', sa.Integer(), sa.ForeignKey('wiki_page.page_id'), nullable=True),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('position', sa.Integer(), server_default='0'),
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=True),
        sa.Column('updated_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_wiki_page_canvas', 'wiki_page', ['canvas_id'])
    op.create_index('idx_wiki_page_parent', 'wiki_page', ['parent_page_id'])


def downgrade() -> None:
    op.drop_index('idx_wiki_page_parent', table_name='wiki_page')
    op.drop_index('idx_wiki_page_canvas', table_name='wiki_page')
    op.drop_table('wiki_page')
    op.drop_index('idx_canvas_member_user', table_name='canvas_member')
    op.drop_table('canvas_member')
    op.drop_index('idx_canvas_branch', table_name='canvas')
    op.drop_index('idx_canvas_created_by', table_name='canvas')
    op.drop_index('idx_canvas_key', table_name='canvas')
    op.drop_table('canvas')
