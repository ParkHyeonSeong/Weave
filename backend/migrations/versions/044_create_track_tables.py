"""create track tables

Revision ID: 044
Revises: 043
Create Date: 2026-05-22

Track: 여러 Branch를 가로지르는 설계/조망 메타 컨테이너.
  - track / track_member / track_branch / track_item / track_link / track_layer
  - v1.0에서는 track + track_member + track_branch + track_item 까지 활성.
  - track_link / track_layer 는 v1.2~v2 영역. 스키마는 미리 잡아둠.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '044'
down_revision: Union[str, None] = '043'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -----------------------------------------------------------------------
    # track
    # -----------------------------------------------------------------------
    op.create_table(
        'track',
        sa.Column('track_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('track_name', sa.String(300), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('color', sa.String(20), nullable=False, server_default='#5E6AD2'),
        sa.Column('icon', sa.String(50), nullable=True),
        sa.Column('visibility', sa.String(20), nullable=False, server_default='private'),
        sa.Column('default_view', sa.String(20), nullable=False, server_default='flow'),
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default=sa.text('FALSE')),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_track_visibility', 'track', ['visibility'])

    # -----------------------------------------------------------------------
    # track_member  (role: owner | editor | viewer)
    # -----------------------------------------------------------------------
    op.create_table(
        'track_member',
        sa.Column('track_id', sa.Integer(),
                  sa.ForeignKey('track.track_id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(),
                  sa.ForeignKey('user.user_id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(20), nullable=False, server_default='editor'),
        sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('track_id', 'user_id', name='pk_track_member'),
    )
    op.create_index('idx_track_member_user', 'track_member', ['user_id'])

    # -----------------------------------------------------------------------
    # track_branch  (Track ↔ Branch 참여 관계 + Track-local override)
    # -----------------------------------------------------------------------
    op.create_table(
        'track_branch',
        sa.Column('track_id', sa.Integer(),
                  sa.ForeignKey('track.track_id', ondelete='CASCADE'), nullable=False),
        sa.Column('branch_id', sa.Integer(),
                  sa.ForeignKey('branch.branch_id', ondelete='CASCADE'), nullable=False),
        sa.Column('display_name_override', sa.String(300), nullable=True),
        sa.Column('color_override', sa.String(20), nullable=True),
        sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('track_id', 'branch_id', name='pk_track_branch'),
    )
    op.create_index('idx_track_branch_branch', 'track_branch', ['branch_id'])

    # -----------------------------------------------------------------------
    # track_layer  (Track 내 사용자 정의 그룹 - v2.1)
    # -----------------------------------------------------------------------
    op.create_table(
        'track_layer',
        sa.Column('layer_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('track_id', sa.Integer(),
                  sa.ForeignKey('track.track_id', ondelete='CASCADE'), nullable=False),
        sa.Column('layer_name', sa.String(100), nullable=False),
        sa.Column('color', sa.String(20), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_track_layer_track', 'track_layer', ['track_id'])

    # -----------------------------------------------------------------------
    # track_item  (Track 내 task/epic 참조 + 위치/위계)
    # -----------------------------------------------------------------------
    op.create_table(
        'track_item',
        sa.Column('item_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('track_id', sa.Integer(),
                  sa.ForeignKey('track.track_id', ondelete='CASCADE'), nullable=False),
        sa.Column('source_type', sa.String(20), nullable=False),  # 'task' | 'epic' | 'note'
        sa.Column('source_task_id', sa.Integer(),
                  sa.ForeignKey('task.task_id', ondelete='CASCADE'), nullable=True),
        sa.Column('source_epic_id', sa.Integer(),
                  sa.ForeignKey('epic.epic_id', ondelete='CASCADE'), nullable=True),
        sa.Column('note_text', sa.Text(), nullable=True),
        sa.Column('layer_id', sa.Integer(),
                  sa.ForeignKey('track_layer.layer_id', ondelete='SET NULL'), nullable=True),
        sa.Column('virtual_parent_id', sa.Integer(),
                  sa.ForeignKey('track_item.item_id', ondelete='SET NULL'), nullable=True),
        sa.Column('position_x', sa.Float(), nullable=False, server_default='0'),
        sa.Column('position_y', sa.Float(), nullable=False, server_default='0'),
        sa.Column('color_override', sa.String(20), nullable=True),
        sa.Column('label_override', sa.String(300), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "(source_type = 'task' AND source_task_id IS NOT NULL)"
            " OR (source_type = 'epic' AND source_epic_id IS NOT NULL)"
            " OR (source_type = 'note')",
            name='ck_track_item_source',
        ),
    )
    op.create_index('idx_track_item_track', 'track_item', ['track_id'])
    op.create_index('idx_track_item_task', 'track_item', ['source_task_id'])
    op.create_index('idx_track_item_epic', 'track_item', ['source_epic_id'])
    # 한 Track 내 같은 task 중복 방지 (note 는 제외)
    op.execute("""
        CREATE UNIQUE INDEX uq_track_item_task
            ON track_item (track_id, source_task_id)
            WHERE source_type = 'task' AND source_task_id IS NOT NULL
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_track_item_epic
            ON track_item (track_id, source_epic_id)
            WHERE source_type = 'epic' AND source_epic_id IS NOT NULL
    """)

    # -----------------------------------------------------------------------
    # track_link  (Track 로컬 edge. v1.2부터 활성)
    # -----------------------------------------------------------------------
    op.create_table(
        'track_link',
        sa.Column('link_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('track_id', sa.Integer(),
                  sa.ForeignKey('track.track_id', ondelete='CASCADE'), nullable=False),
        sa.Column('source_item_id', sa.Integer(),
                  sa.ForeignKey('track_item.item_id', ondelete='CASCADE'), nullable=False),
        sa.Column('target_item_id', sa.Integer(),
                  sa.ForeignKey('track_item.item_id', ondelete='CASCADE'), nullable=False),
        sa.Column('link_type', sa.String(20), nullable=False, server_default='flow_to'),
        sa.Column('materialized_dependency_id', sa.Integer(),
                  sa.ForeignKey('task_dependency.dependency_id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.user_id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('source_item_id', 'target_item_id', 'link_type',
                            name='uq_track_link_pair'),
    )
    op.create_index('idx_track_link_track', 'track_link', ['track_id'])


def downgrade() -> None:
    op.drop_index('idx_track_link_track', table_name='track_link')
    op.drop_table('track_link')

    op.execute("DROP INDEX IF EXISTS uq_track_item_epic")
    op.execute("DROP INDEX IF EXISTS uq_track_item_task")
    op.drop_index('idx_track_item_epic', table_name='track_item')
    op.drop_index('idx_track_item_task', table_name='track_item')
    op.drop_index('idx_track_item_track', table_name='track_item')
    op.drop_table('track_item')

    op.drop_index('idx_track_layer_track', table_name='track_layer')
    op.drop_table('track_layer')

    op.drop_index('idx_track_branch_branch', table_name='track_branch')
    op.drop_table('track_branch')

    op.drop_index('idx_track_member_user', table_name='track_member')
    op.drop_table('track_member')

    op.drop_index('idx_track_visibility', table_name='track')
    op.drop_table('track')
