"""create password_reset_token table

Revision ID: 052
Revises: 051
Create Date: 2026-06-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = '052'
down_revision: Union[str, None] = '051'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'password_reset_token',
        sa.Column('token_id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.BigInteger(),
                  sa.ForeignKey('user.user_id', ondelete='CASCADE'), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_prt_token_hash', 'password_reset_token', ['token_hash'], unique=True)
    op.create_index('idx_prt_user', 'password_reset_token', ['user_id'])


def downgrade() -> None:
    op.drop_index('idx_prt_user', table_name='password_reset_token')
    op.drop_index('idx_prt_token_hash', table_name='password_reset_token')
    op.drop_table('password_reset_token')
