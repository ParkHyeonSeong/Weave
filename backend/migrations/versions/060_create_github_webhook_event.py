"""create github_webhook_event table (idempotent staging + single-winner claim)

Revision ID: 060
Revises: 059
Create Date: 2026-06-26
"""
from typing import Sequence, Union
from alembic import op

revision: str = '060'
down_revision: Union[str, None] = '059'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE github_webhook_event (
            event_id      SERIAL PRIMARY KEY,
            delivery_id   TEXT NOT NULL UNIQUE,
            event_type    TEXT NOT NULL,
            payload       JSONB NOT NULL,
            status        TEXT NOT NULL DEFAULT 'pending',
            attempts      INTEGER NOT NULL DEFAULT 0,
            locked_at     TIMESTAMPTZ,
            processed_at  TIMESTAMPTZ,
            last_error    TEXT,
            next_attempt_at TIMESTAMPTZ,
            received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    # 단일승자 claim 스캔용 부분 인덱스: 미처리(pending/failed)만 인덱싱해 작은 인덱스로
    # received_at 순서 ORDER BY + FOR UPDATE SKIP LOCKED를 빠르게 받친다.
    op.execute("""
        CREATE INDEX idx_ghwe_claimable ON github_webhook_event(received_at)
        WHERE status IN ('pending', 'failed')
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_ghwe_claimable")
    op.execute("DROP TABLE IF EXISTS github_webhook_event")
