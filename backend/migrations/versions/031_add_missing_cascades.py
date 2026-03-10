"""add missing ON DELETE CASCADE constraints

Revision ID: 031
Revises: 030
Create Date: 2026-03-10
"""
from typing import Sequence, Union
from alembic import op

revision: str = '031'
down_revision: Union[str, None] = '030'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # branch_member.branch_id -> CASCADE
    op.drop_constraint('branch_member_branch_id_fkey', 'branch_member', type_='foreignkey')
    op.create_foreign_key('branch_member_branch_id_fkey', 'branch_member', 'branch',
                          ['branch_id'], ['branch_id'], ondelete='CASCADE')

    # canvas_member.canvas_id -> CASCADE
    op.drop_constraint('canvas_member_canvas_id_fkey', 'canvas_member', type_='foreignkey')
    op.create_foreign_key('canvas_member_canvas_id_fkey', 'canvas_member', 'canvas',
                          ['canvas_id'], ['canvas_id'], ondelete='CASCADE')

    # canvas_page.canvas_id -> CASCADE
    op.drop_constraint('canvas_page_canvas_id_fkey', 'canvas_page', type_='foreignkey')
    op.create_foreign_key('canvas_page_canvas_id_fkey', 'canvas_page', 'canvas',
                          ['canvas_id'], ['canvas_id'], ondelete='CASCADE')


def downgrade() -> None:
    # canvas_page.canvas_id -> 원래대로 (CASCADE 없음)
    op.drop_constraint('canvas_page_canvas_id_fkey', 'canvas_page', type_='foreignkey')
    op.create_foreign_key('canvas_page_canvas_id_fkey', 'canvas_page', 'canvas',
                          ['canvas_id'], ['canvas_id'])

    # canvas_member.canvas_id -> 원래대로
    op.drop_constraint('canvas_member_canvas_id_fkey', 'canvas_member', type_='foreignkey')
    op.create_foreign_key('canvas_member_canvas_id_fkey', 'canvas_member', 'canvas',
                          ['canvas_id'], ['canvas_id'])

    # branch_member.branch_id -> 원래대로
    op.drop_constraint('branch_member_branch_id_fkey', 'branch_member', type_='foreignkey')
    op.create_foreign_key('branch_member_branch_id_fkey', 'branch_member', 'branch',
                          ['branch_id'], ['branch_id'])
