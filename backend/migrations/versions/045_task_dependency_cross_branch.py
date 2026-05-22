"""relax task_dependency.branch_id for cross-branch dependencies

Revision ID: 045
Revises: 044
Create Date: 2026-05-22

기존 task_dependency.branch_id는 NOT NULL이라 같은 Branch 내 의존성만 허용했음.
Track 기능에서 cross-branch dependency를 materialize 하려면 source/target task의
branch가 다를 수 있어야 함.

- branch_id를 nullable로 변경 (NULL = cross-branch)
- 단일 branch 의존성은 그대로 branch_id를 채워서 유지 (기존 호환)
- 응용 로직에서는 source/target task의 branch_id가 같으면 branch_id 자동 채움.
"""
from typing import Sequence, Union
from alembic import op

revision: str = '045'
down_revision: Union[str, None] = '044'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('task_dependency', 'branch_id', nullable=True)


def downgrade() -> None:
    # NULL이 있으면 일단 0으로 채워 넣어야 NOT NULL로 못 돌릴 수 있음 → 데이터 손실
    # 따라서 NULL 행이 있으면 downgrade 실패하게 그대로 둠.
    op.alter_column('task_dependency', 'branch_id', nullable=False)
