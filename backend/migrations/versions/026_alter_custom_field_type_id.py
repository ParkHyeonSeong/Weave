"""migrate custom_field from branch_id to type_id

Revision ID: 026
Revises: 025
Create Date: 2026-03-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '026'
down_revision: Union[str, None] = '025'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add type_id column (nullable initially for data migration)
    op.add_column('custom_field', sa.Column(
        'type_id', sa.Integer(),
        sa.ForeignKey('task_type_config.type_id', ondelete='CASCADE'),
        nullable=True,
    ))

    # 2. Migrate existing data: set type_id to the first task type of the branch
    op.execute("""
        UPDATE custom_field cf
        SET type_id = (
            SELECT ttc.type_id
            FROM task_type_config ttc
            WHERE ttc.branch_id = cf.branch_id
            ORDER BY ttc.sort_order, ttc.type_id
            LIMIT 1
        )
    """)

    # 3. Delete orphans that have no matching task type
    op.execute("""
        DELETE FROM custom_field WHERE type_id IS NULL
    """)

    # 4. Make type_id NOT NULL
    op.alter_column('custom_field', 'type_id', nullable=False)

    # 5. Drop old unique constraint and index
    op.drop_constraint('uq_custom_field_branch_name', 'custom_field', type_='unique')
    op.drop_index('idx_custom_field_branch', table_name='custom_field')

    # 6. Drop branch_id column
    op.drop_column('custom_field', 'branch_id')

    # 7. Add new unique constraint and index
    op.create_unique_constraint('uq_custom_field_type_name', 'custom_field', ['type_id', 'field_name'])
    op.create_index('idx_custom_field_type', 'custom_field', ['type_id'])


def downgrade() -> None:
    # 1. Add branch_id column back
    op.add_column('custom_field', sa.Column(
        'branch_id', sa.Integer(),
        sa.ForeignKey('branch.branch_id', ondelete='CASCADE'),
        nullable=True,
    ))

    # 2. Migrate data back: set branch_id from task_type_config
    op.execute("""
        UPDATE custom_field cf
        SET branch_id = (
            SELECT ttc.branch_id
            FROM task_type_config ttc
            WHERE ttc.type_id = cf.type_id
        )
    """)

    # 3. Make branch_id NOT NULL
    op.alter_column('custom_field', 'branch_id', nullable=False)

    # 4. Drop new constraint and index
    op.drop_constraint('uq_custom_field_type_name', 'custom_field', type_='unique')
    op.drop_index('idx_custom_field_type', table_name='custom_field')

    # 5. Drop type_id column
    op.drop_column('custom_field', 'type_id')

    # 6. Recreate old constraint and index
    op.create_unique_constraint('uq_custom_field_branch_name', 'custom_field', ['branch_id', 'field_name'])
    op.create_index('idx_custom_field_branch', 'custom_field', ['branch_id'])
