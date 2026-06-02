"""create personal_access_token table"""
from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = '048'
down_revision: Union[str, None] = '047'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'personal_access_token',
        sa.Column('pat_id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.BigInteger(),
                  sa.ForeignKey('user.user_id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('token_prefix', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_pat_token_hash', 'personal_access_token', ['token_hash'], unique=True)
    op.create_index('idx_pat_user', 'personal_access_token', ['user_id'],
                    postgresql_where=sa.text('revoked_at IS NULL'))


def downgrade() -> None:
    op.drop_index('idx_pat_user', table_name='personal_access_token')
    op.drop_index('idx_pat_token_hash', table_name='personal_access_token')
    op.drop_table('personal_access_token')
