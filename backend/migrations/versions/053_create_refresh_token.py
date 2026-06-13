"""create refresh_token table (SEC-29)

access 토큰을 단기화하고, 장기 세션은 서버측에 저장된 refresh 토큰으로 갱신한다.
토큰은 해시로만 저장(평문 미저장)하며, 행 삭제로 즉시 폐기(revoke)된다.

Revision ID: 053
Revises: 052
Create Date: 2026-06-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = '053'
down_revision: Union[str, None] = '052'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'refresh_token',
        sa.Column('token_id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.BigInteger(),
                  sa.ForeignKey('user.user_id', ondelete='CASCADE'), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_rt_token_hash', 'refresh_token', ['token_hash'], unique=True)
    op.create_index('idx_rt_user', 'refresh_token', ['user_id'])


def downgrade() -> None:
    op.drop_index('idx_rt_user', table_name='refresh_token')
    op.drop_index('idx_rt_token_hash', table_name='refresh_token')
    op.drop_table('refresh_token')
