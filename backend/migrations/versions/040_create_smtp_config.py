"""create smtp_config table

Revision ID: 040
Revises: 039
Create Date: 2026-03-26
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '040'
down_revision: Union[str, None] = '039'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'smtp_config',
        sa.Column('config_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('smtp_host', sa.String(255), nullable=False),
        sa.Column('smtp_port', sa.Integer(), nullable=False, server_default='587'),
        sa.Column('smtp_user', sa.String(255), nullable=False),
        sa.Column('smtp_password', sa.Text(), nullable=False),
        sa.Column('sender_email', sa.String(255), nullable=False),
        sa.Column('sender_name', sa.String(255), server_default=''),
        sa.Column('use_tls', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('updated_by', sa.Integer(), sa.ForeignKey('user.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('smtp_config')
