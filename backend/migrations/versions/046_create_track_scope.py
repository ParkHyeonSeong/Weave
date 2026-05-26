"""create track_scope

Revision ID: 046
Revises: 045
Create Date: 2026-05-26

Track 내 Bulk import scope marker.
- (track_id, branch_id, scope_type, scope_id) — composite PK
- scope_type: 'sprint' | 'epic'  (scope_id가 가리키는 테이블 구분)
- Bulk Sprint/Epic/Filter import 시 row 생성. Sidebar tree에서 group 단위로 활용.
- track / branch CASCADE — sprint/epic 자체는 FK로 묶지 않음 (sprint 삭제 시 stale row는 sidebar query에서 LEFT JOIN으로 걸러냄).
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '046'
down_revision: Union[str, None] = '045'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'track_scope',
        sa.Column('track_id', sa.Integer(),
                  sa.ForeignKey('track.track_id', ondelete='CASCADE'), nullable=False),
        sa.Column('branch_id', sa.Integer(),
                  sa.ForeignKey('branch.branch_id', ondelete='CASCADE'), nullable=False),
        sa.Column('scope_type', sa.String(16), nullable=False),
        sa.Column('scope_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('track_id', 'branch_id', 'scope_type', 'scope_id',
                                name='pk_track_scope'),
        sa.CheckConstraint("scope_type IN ('sprint', 'epic')",
                           name='ck_track_scope_type'),
    )
    op.create_index('idx_track_scope_track', 'track_scope', ['track_id'])
    op.create_index('idx_track_scope_branch', 'track_scope', ['track_id', 'branch_id'])


def downgrade() -> None:
    op.drop_index('idx_track_scope_branch', table_name='track_scope')
    op.drop_index('idx_track_scope_track', table_name='track_scope')
    op.drop_table('track_scope')
