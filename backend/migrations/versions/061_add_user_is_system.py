"""add user.is_system + seed 'GitHub' bot user

Revision ID: 061
Revises: 060
Create Date: 2026-06-26
"""
from typing import Sequence, Union
from alembic import op

revision: str = '061'
down_revision: Union[str, None] = '060'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('ALTER TABLE "user" ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT FALSE')
    # 'GitHub' 시스템 봇 시드: 자동 전이의 activity_log.actor_id / notification.actor_id
    # (둘 다 NOT NULL FK)로 쓰인다. password는 NOT NULL LargeBinary라 빈 바이트로 채우되
    # 봇은 로그인하지 않는다(status='active'는 멤버 가시성 쿼리와 무관, is_system 필터로 숨김).
    op.execute("""
        INSERT INTO "user" (email, password, username, status, role, is_system)
        VALUES ('github-bot@weave.local', ''::bytea, 'GitHub', 'active', 'member', TRUE)
        ON CONFLICT (email) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM \"user\" WHERE email = 'github-bot@weave.local'")
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS is_system')
