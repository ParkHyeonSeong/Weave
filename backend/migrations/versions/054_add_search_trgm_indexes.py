"""add pg_trgm + GIN trigram indexes for inline ref search

Revision ID: 054
Revises: 053
Create Date: 2026-06-18

인라인 ref 검색(/chat/*-search) 가속 + HTML 태그 노이즈 제거용 인덱스.
- 평문 컬럼(title/canvas_name): GIN trgm 직접
- HTML 컬럼(description/body/content): regexp_replace로 태그 제거한 식에 함수형 GIN trgm
검색 모델(core/model)의 WHERE 식과 함수형 인덱스 식은 반드시 동일해야 한다(테이블
별칭 t./i./p.는 플래너가 컬럼으로 정규화하므로 무관).

주의:
- pg_trgm 생성에는 권한이 필요하다. 도커 DB(postgres)는 슈퍼유저라 OK이나, 매니지드
  Postgres라면 슈퍼유저 1회 선행 또는 프로바이더 allowlist 필요.
- 태그 제거 정규식 '<[^>]+>'는 well-formed HTML(속성 내 리터럴 '>'는 &gt;로 인코딩)을
  가정한다. 본문은 TipTap·nh3 등 실제 파서 산출이라 이 가정이 성립한다.
"""
from typing import Sequence, Union

from alembic import op

revision: str = '054'
down_revision: Union[str, None] = '053'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# 태그 제거 식 — core/model 의 search_for_chat WHERE 와 글자 그대로 동일해야 함
_STRIP = "regexp_replace({col}, '<[^>]+>', ' ', 'g')"

_PLAIN = [
    ("idx_task_title_trgm", "task", "title"),
    ("idx_issue_title_trgm", "task_issue", "title"),
    ("idx_canvas_page_title_trgm", "canvas_page", "title"),
    ("idx_canvas_name_trgm", "canvas", "canvas_name"),
]
_HTML = [
    ("idx_task_desc_trgm", "task", "description"),
    ("idx_issue_body_trgm", "task_issue", "body"),
    ("idx_canvas_page_content_trgm", "canvas_page", "content"),
]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    for name, table, col in _PLAIN:
        op.execute(
            f"CREATE INDEX IF NOT EXISTS {name} ON {table} USING gin ({col} gin_trgm_ops)")
    for name, table, col in _HTML:
        expr = _STRIP.format(col=col)
        op.execute(
            f"CREATE INDEX IF NOT EXISTS {name} ON {table} USING gin (({expr}) gin_trgm_ops)")


def downgrade() -> None:
    for name, _, _ in _PLAIN + _HTML:
        op.execute(f"DROP INDEX IF EXISTS {name}")
    # pg_trgm 확장은 다른 기능이 쓸 수 있어 남겨둔다
