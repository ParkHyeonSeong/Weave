"""Widen task.status / task.task_type to match config key width.

workflow_status.key와 task_type_config.type_key는 String(50)(+validator 50자)
인데 task.status/task.task_type이 String(20)이라, 21자 이상 key는 유효한
config인데도 task 저장 시 length 에러 500이 났다(명시 지정·기본값·GitHub
자동 전이 모두 같은 컬럼). 컬럼을 50으로 넓혀 정합시킨다. Postgres에서
varchar 길이 확장은 카탈로그-only 변경이라 테이블 리라이트가 없다.

Revision ID: 063
Revises: 062
Create Date: 2026-07-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '063'
down_revision: Union[str, None] = '062'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('task', 'task_type', type_=sa.String(50),
                    existing_type=sa.String(20), existing_nullable=False,
                    existing_server_default='task')
    op.alter_column('task', 'status', type_=sa.String(50),
                    existing_type=sa.String(20), existing_nullable=False,
                    existing_server_default='todo')


def downgrade() -> None:
    # 20자 초과 데이터가 있으면 실패한다 — 의도적(무손실 다운그레이드 불가).
    op.alter_column('task', 'status', type_=sa.String(20),
                    existing_type=sa.String(50), existing_nullable=False,
                    existing_server_default='todo')
    op.alter_column('task', 'task_type', type_=sa.String(20),
                    existing_type=sa.String(50), existing_nullable=False,
                    existing_server_default='task')
