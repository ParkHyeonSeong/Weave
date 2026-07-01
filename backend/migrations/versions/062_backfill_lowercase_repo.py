"""Backfill repo_full_name to lowercase (github_integration + task_github_ref).

The model write paths were normalized to lowercase (73d2ae6) and lookups are
case-insensitive (LOWER=LOWER), but the DB UNIQUE constraints are case-sensitive,
so any rows stored before the normalization patch may be mixed-case and would
escape duplicate detection. This migration lowercases existing repo_full_name on
both tables so the case-sensitive UNIQUE constraints effectively enforce
case-insensitive identity for ALL rows.

FAIL-FAST: if a case-insensitive duplicate group already exists (a genuine
Org/Repo + org/repo double-connect), the migration ABORTS with a descriptive
error rather than silently deleting a row — the operator resolves the duplicate
manually, then re-runs. On a DB that only ever had lowercase rows this is a no-op.

Revision ID: 062
Revises: 061
Create Date: 2026-07-01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '062'
down_revision: Union[str, None] = '061'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1) fail-fast collision checks — one per case-insensitive uniqueness group.
    integration_dupes = bind.execute(sa.text("""
        SELECT branch_id, LOWER(repo_full_name) AS norm, COUNT(*) AS cnt
        FROM github_integration
        GROUP BY branch_id, LOWER(repo_full_name)
        HAVING COUNT(*) > 1
    """)).fetchall()
    if integration_dupes:
        raise RuntimeError(
            "062 backfill aborted: github_integration has case-insensitive "
            "duplicate repo_full_name groups (branch_id, LOWER(repo_full_name)): "
            f"{[(r.branch_id, r.norm, r.cnt) for r in integration_dupes]}. "
            "Merge or delete the duplicate integration row(s) for these branches, "
            "then re-run migration 062."
        )

    ref_pr_dupes = bind.execute(sa.text("""
        SELECT task_id, LOWER(repo_full_name) AS norm, ref_number, COUNT(*) AS cnt
        FROM task_github_ref
        WHERE ref_type = 'pull_request'
        GROUP BY task_id, LOWER(repo_full_name), ref_number
        HAVING COUNT(*) > 1
    """)).fetchall()
    if ref_pr_dupes:
        raise RuntimeError(
            "062 backfill aborted: task_github_ref has case-insensitive duplicate "
            "pull_request groups (task_id, LOWER(repo_full_name), ref_number): "
            f"{[(r.task_id, r.norm, r.ref_number, r.cnt) for r in ref_pr_dupes]}. "
            "Merge or delete the duplicate ref row(s) for these tasks, then re-run "
            "migration 062."
        )

    ref_commit_dupes = bind.execute(sa.text("""
        SELECT task_id, LOWER(repo_full_name) AS norm, sha, COUNT(*) AS cnt
        FROM task_github_ref
        WHERE ref_type = 'commit'
        GROUP BY task_id, LOWER(repo_full_name), sha
        HAVING COUNT(*) > 1
    """)).fetchall()
    if ref_commit_dupes:
        raise RuntimeError(
            "062 backfill aborted: task_github_ref has case-insensitive duplicate "
            "commit groups (task_id, LOWER(repo_full_name), sha): "
            f"{[(r.task_id, r.norm, r.sha, r.cnt) for r in ref_commit_dupes]}. "
            "Merge or delete the duplicate ref row(s) for these tasks, then re-run "
            "migration 062."
        )

    # 2) checks passed — lowercase in place, touching only mixed-case rows.
    op.execute("""
        UPDATE github_integration
        SET repo_full_name = LOWER(repo_full_name)
        WHERE repo_full_name <> LOWER(repo_full_name)
    """)
    op.execute("""
        UPDATE task_github_ref
        SET repo_full_name = LOWER(repo_full_name)
        WHERE repo_full_name <> LOWER(repo_full_name)
    """)


def downgrade() -> None:
    # Forward-only data fix: original casing is not recorded anywhere, so
    # lowercasing cannot be reversibly restored.
    pass
