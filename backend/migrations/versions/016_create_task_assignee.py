"""task_assignee 테이블 생성 및 assignee_id 데이터 마이그레이션

Revision ID: 016
Revises: 015
Create Date: 2026-03-06
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '016'
down_revision: Union[str, None] = '015'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # task_assignee 다대다 테이블 (메인/서브 담당자)
    op.create_table(
        'task_assignee',
        sa.Column('task_id', sa.Integer(), sa.ForeignKey('task.task_id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.user_id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(10), nullable=False, server_default='sub'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('task_id', 'user_id'),
        sa.CheckConstraint("role IN ('main', 'sub')", name='ck_task_assignee_role'),
    )
    op.create_index('idx_task_assignee_user', 'task_assignee', ['user_id'])

    # 기존 assignee_id 데이터를 task_assignee로 마이그레이션
    op.execute("""
        INSERT INTO task_assignee (task_id, user_id, role)
        SELECT task_id, assignee_id, 'main'
        FROM task
        WHERE assignee_id IS NOT NULL
    """)

    # task 테이블에서 assignee_id 컬럼 제거
    op.drop_index('idx_task_assignee', table_name='task')
    op.drop_column('task', 'assignee_id')


def downgrade() -> None:
    # assignee_id 컬럼 복원
    op.add_column('task', sa.Column(
        'assignee_id', sa.Integer(),
        sa.ForeignKey('user.user_id', ondelete='SET NULL'), nullable=True
    ))
    op.create_index('idx_task_assignee', 'task', ['assignee_id'])

    # main 담당자 데이터 복원
    op.execute("""
        UPDATE task SET assignee_id = (
            SELECT user_id FROM task_assignee
            WHERE task_assignee.task_id = task.task_id AND role = 'main'
        )
    """)

    # task_assignee 테이블 삭제
    op.drop_index('idx_task_assignee_user', table_name='task_assignee')
    op.drop_table('task_assignee')
