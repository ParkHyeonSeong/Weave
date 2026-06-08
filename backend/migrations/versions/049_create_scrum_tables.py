"""create scrum tables

Revision ID: 049
Revises: 048
Create Date: 2026-06-08

Scrum: 독립 팀 보드 기반 주간 데일리스크럼 + 회고.
  - scrum_board  : 팀 컨테이너(회고 주기 설정 포함)
  - scrum_member : 자체 멤버십 (role: admin | member)
  - scrum_week   : ISO 주마다 1 Yjs 문서(데일리 그리드)  [Plan 2에서 사용]
  - scrum_retro  : 주기 기반 회고 1 Yjs 문서             [Plan 4에서 사용]
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '049'
down_revision: Union[str, None] = '048'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'scrum_board',
        sa.Column('board_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(300), nullable=False),
        sa.Column('icon', sa.String(50), nullable=True),
        sa.Column('color', sa.String(20), nullable=False, server_default='#16A34A'),
        sa.Column('visibility', sa.String(20), nullable=False, server_default='private'),
        sa.Column('retro_cadence', sa.String(20), nullable=False, server_default='weekly'),
        sa.Column('retro_interval_weeks', sa.Integer(), nullable=True),
        sa.Column('retro_template', sa.String(20), nullable=False, server_default='kpt'),
        sa.Column('retro_anchor_weekday', sa.Integer(), nullable=False, server_default='4'),
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default=sa.text('FALSE')),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        'scrum_member',
        sa.Column('board_id', sa.Integer(),
                  sa.ForeignKey('scrum_board.board_id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(),
                  sa.ForeignKey('user.user_id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(20), nullable=False, server_default='member'),
        sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('board_id', 'user_id', name='pk_scrum_member'),
    )
    op.create_index('idx_scrum_member_user', 'scrum_member', ['user_id'])

    op.create_table(
        'scrum_week',
        sa.Column('week_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('board_id', sa.Integer(),
                  sa.ForeignKey('scrum_board.board_id', ondelete='CASCADE'), nullable=False),
        sa.Column('iso_year', sa.Integer(), nullable=False),
        sa.Column('iso_week', sa.Integer(), nullable=False),
        sa.Column('yjs_state', sa.LargeBinary(), nullable=True),
        sa.Column('yjs_updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('board_id', 'iso_year', 'iso_week', name='uq_scrum_week'),
    )
    op.create_index('idx_scrum_week_board', 'scrum_week', ['board_id'])

    op.create_table(
        'scrum_retro',
        sa.Column('retro_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('board_id', sa.Integer(),
                  sa.ForeignKey('scrum_board.board_id', ondelete='CASCADE'), nullable=False),
        sa.Column('period_start', sa.Date(), nullable=False),
        sa.Column('period_end', sa.Date(), nullable=False),
        sa.Column('template', sa.String(20), nullable=False, server_default='kpt'),
        sa.Column('status', sa.String(20), nullable=False, server_default='open'),
        sa.Column('yjs_state', sa.LargeBinary(), nullable=True),
        sa.Column('yjs_updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('board_id', 'period_start', name='uq_scrum_retro'),
    )
    op.create_index('idx_scrum_retro_board', 'scrum_retro', ['board_id'])


def downgrade() -> None:
    op.drop_index('idx_scrum_retro_board', table_name='scrum_retro')
    op.drop_table('scrum_retro')
    op.drop_index('idx_scrum_week_board', table_name='scrum_week')
    op.drop_table('scrum_week')
    op.drop_index('idx_scrum_member_user', table_name='scrum_member')
    op.drop_table('scrum_member')
    op.drop_table('scrum_board')
