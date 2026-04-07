"""기존 branch에 cancelled workflow_status 추가

Revision ID: 043
Revises: 042
Create Date: 2026-04-07
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '043'
down_revision: Union[str, None] = '042'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 기존 모든 branch에 cancelled 상태 추가 (아직 없는 경우만)
    op.execute(sa.text("""
        INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order, is_default)
        SELECT b.branch_id, 'cancelled', 'Cancelled', '#DC2626', 'cancelled',
               COALESCE((SELECT MAX(ws.sort_order) + 1 FROM workflow_status ws WHERE ws.branch_id = b.branch_id), 0),
               FALSE
        FROM branch b
        WHERE NOT EXISTS (
            SELECT 1 FROM workflow_status ws
            WHERE ws.branch_id = b.branch_id AND ws.key = 'cancelled'
        )
    """))


def downgrade() -> None:
    # cancelled 상태의 task가 없는 branch에서만 삭제
    op.execute(sa.text("""
        DELETE FROM workflow_status ws
        WHERE ws.key = 'cancelled' AND ws.category = 'cancelled'
          AND NOT EXISTS (
              SELECT 1 FROM task t
              WHERE t.branch_id = ws.branch_id AND t.status = 'cancelled'
          )
    """))
