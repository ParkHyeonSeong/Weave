"""add scope column to saved_view (MyTasks 개인 뷰 my/all 영속)

Revision ID: 056
Revises: 055
Create Date: 2026-06-24
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '056'
down_revision: Union[str, None] = '055'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 개인(크로스브랜치) 뷰의 my/all 스코프. 브랜치 뷰는 NULL(스코프 개념 없음). 기존 행은 NULL→프론트 'my' 기본.
    op.add_column('saved_view', sa.Column('scope', sa.String(10), nullable=True))
    # 계약을 DB 레벨에서도 못박는다(리뷰 P2): scope는 개인 뷰(scope_branch_id IS NULL)에서만 'my'/'all',
    # 그 외엔 NULL. 컨트롤러가 우선 거부하지만 직접 INSERT/버그도 방지. 기존 행은 모두 NULL이라 통과.
    op.create_check_constraint(
        'ck_saved_view_scope',
        'saved_view',
        "scope IS NULL OR (scope_branch_id IS NULL AND scope IN ('my','all'))",
    )


def downgrade() -> None:
    op.drop_constraint('ck_saved_view_scope', 'saved_view', type_='check')
    op.drop_column('saved_view', 'scope')
