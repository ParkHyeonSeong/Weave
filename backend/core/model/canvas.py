from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# 기여자 아바타 색상 — branch.py / 프론트 library/userAvatar.js 의 팔레트와 동일.
# user_id 를 안정적으로 같은 색에 매핑(흰 텍스트와 WCAG AA 대비 확보된 톤).
_AVATAR_COLORS = [
    '#5E6AD2', '#059669', '#B45309', '#9333EA',
    '#BE185D', '#0369A1', '#DC2626',
]


def _user_color(user_id) -> str:
    if user_id is None:
        return '#9CA3AF'
    return _AVATAR_COLORS[abs(int(user_id)) % len(_AVATAR_COLORS)]


async def create(canvas_name: str, key: str, description: str,
                 visibility: str, created_by: int, branch_id: int, db: AsyncSession) -> int:
    """Canvas 생성"""
    result = await db.execute(text("""
        INSERT INTO canvas (canvas_name, key, description, visibility, created_by, branch_id)
        VALUES (:canvas_name, :key, :description, :visibility, :created_by, :branch_id)
        RETURNING canvas_id
    """), {
        'canvas_name': canvas_name,
        'key': key,
        'description': description,
        'visibility': visibility,
        'created_by': created_by,
        'branch_id': branch_id,
    })
    return result.scalar_one()


async def find_by_id(canvas_id: int, db: AsyncSession):
    """Canvas 상세 조회"""
    result = await db.execute(text("""
        SELECT c.canvas_id, c.canvas_name, c.key, c.description,
               c.icon, c.color, c.visibility, c.is_archived,
               c.branch_id, c.created_by, c.created_at, c.updated_at
        FROM canvas c
        WHERE c.canvas_id = :canvas_id AND c.is_archived = FALSE
    """), {'canvas_id': canvas_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_accessible(user_id: int, db: AsyncSession):
    """사용자가 접근 가능한 Canvas 목록 (홈 카드 집계 필드 포함).

    각 canvas dict 에 추가되는 필드:
    - page_count (아카이브 안 된 소속 페이지 수)
    - last_edited_at (소속 페이지의 MAX(updated_at), 보강용으로 created_at fallback;
      페이지 없으면 None)
    - contributor_count, contributors (상위 4명 [{name, color}])

    contributors 정의: 페이지를 만들었거나 편집한 사용자(created_by ∪ updated_by) 중
    distinct. canvas_member 보다 "문서에 실제로 기여한 사람"을 더 잘 표현한다.

    집계는 단일 목록 쿼리에서 상관 서브쿼리로 처리하고, 기여자 미리보기만 별도
    배치 쿼리 1회로 가져와 N+1 을 피한다.
    """
    result = await db.execute(text("""
        SELECT c.canvas_id, c.canvas_name, c.key, c.description,
               c.icon, c.color, c.visibility, c.branch_id, c.created_at,
               cm.role AS my_role,
               COALESCE(pa.page_count, 0) AS page_count,
               pa.last_edited_at
        FROM canvas c
        INNER JOIN canvas_member cm ON c.canvas_id = cm.canvas_id
        LEFT JOIN (
            SELECT p.canvas_id,
                   COUNT(*) AS page_count,
                   MAX(COALESCE(p.updated_at, p.created_at)) AS last_edited_at
            FROM canvas_page p
            WHERE p.is_archived = FALSE
            GROUP BY p.canvas_id
        ) pa ON pa.canvas_id = c.canvas_id
        WHERE cm.user_id = :user_id AND c.is_archived = FALSE
        ORDER BY c.canvas_name
    """), {'user_id': user_id})
    canvases = [dict(row._mapping) for row in result.fetchall()]

    if not canvases:
        return canvases

    for c in canvases:
        c['contributors'] = []
        c['contributor_count'] = 0

    # 기여자 미리보기(상위 4명) 배치 조회 — canvas 당 페이지를 만들거나 편집한
    # distinct 사용자. created_by/updated_by 를 UNION 해 첫 활동 순으로 4명까지.
    canvas_ids = [c['canvas_id'] for c in canvases]
    contrib_result = await db.execute(text("""
        SELECT canvas_id, user_id, username, total
        FROM (
            SELECT cw.canvas_id, cw.user_id, u.username, cw.first_seen,
                   COUNT(*) OVER (PARTITION BY cw.canvas_id) AS total,
                   ROW_NUMBER() OVER (
                       PARTITION BY cw.canvas_id
                       ORDER BY cw.first_seen, cw.user_id
                   ) AS rn
            FROM (
                SELECT p.canvas_id, contributor.user_id,
                       MIN(p.created_at) AS first_seen
                FROM canvas_page p
                CROSS JOIN LATERAL (
                    SELECT p.created_by AS user_id
                    UNION
                    SELECT p.updated_by AS user_id
                ) contributor
                WHERE p.canvas_id = ANY(:canvas_ids)
                  AND p.is_archived = FALSE
                  AND contributor.user_id IS NOT NULL
                GROUP BY p.canvas_id, contributor.user_id
            ) cw
            INNER JOIN "user" u ON cw.user_id = u.user_id
        ) ranked
        WHERE rn <= 4
        ORDER BY canvas_id, rn
    """), {'canvas_ids': canvas_ids})

    by_canvas = {c['canvas_id']: c for c in canvases}
    for row in contrib_result.fetchall():
        m = row._mapping
        c = by_canvas[m['canvas_id']]
        c['contributor_count'] = m['total']
        c['contributors'].append({
            'name': m['username'],
            'color': _user_color(m['user_id']),
        })

    return canvases


async def home_stats(user_id: int, db: AsyncSession):
    """사용자가 접근 가능한 Canvas 전체에 대한 홈 KPI 집계.

    - total_docs: 접근 가능한 canvas 의 아카이브 안 된 페이지 총수
    - edited_this_week: updated_at(없으면 created_at) 가 최근 7일 이내인 페이지 수
    - starred_count: 사용자의 doc 타입 star 수 (item_type = 'doc')

    mention_count 는 doc/page 멘션 메커니즘이 스키마에 없어 포함하지 않는다.
    (멘션은 task_comment 전용으로만 존재.)
    """
    result = await db.execute(text("""
        WITH my_canvases AS (
            SELECT c.canvas_id
            FROM canvas c
            INNER JOIN canvas_member cm ON c.canvas_id = cm.canvas_id
            WHERE cm.user_id = :user_id AND c.is_archived = FALSE
        ),
        my_pages AS (
            SELECT p.page_id, COALESCE(p.updated_at, p.created_at) AS edited_at
            FROM canvas_page p
            INNER JOIN my_canvases mc ON mc.canvas_id = p.canvas_id
            WHERE p.is_archived = FALSE
        )
        SELECT
            (SELECT COUNT(*) FROM my_pages) AS total_docs,
            (SELECT COUNT(*) FROM my_pages
             WHERE edited_at >= NOW() - INTERVAL '7 days') AS edited_this_week,
            (SELECT COUNT(*) FROM user_star us
             WHERE us.user_id = :user_id AND us.item_type = 'doc') AS starred_count
    """), {'user_id': user_id})
    row = result.fetchone()
    return {
        'total_docs': row._mapping['total_docs'],
        'edited_this_week': row._mapping['edited_this_week'],
        'starred_count': row._mapping['starred_count'],
    }


async def update(canvas_id: int, fields: dict, db: AsyncSession):
    """Canvas 정보 수정"""
    set_clauses = ', '.join(f'{k} = :{k}' for k in fields)
    params = {**fields, 'canvas_id': canvas_id}
    await db.execute(text(f"""
        UPDATE canvas SET {set_clauses}, updated_at = NOW()
        WHERE canvas_id = :canvas_id
    """), params)


async def find_by_key(key: str, db: AsyncSession):
    """key로 Canvas 조회 (중복 체크용)"""
    result = await db.execute(text("""
        SELECT canvas_id FROM canvas WHERE key = :key
    """), {'key': key})
    return result.fetchone() is not None


async def hard_delete(canvas_id: int, db: AsyncSession):
    """Canvas 영구 삭제 (CASCADE로 페이지, 멤버 자동 삭제)"""
    # recent_view, user_star에서 관련 문서 기록 정리
    await db.execute(text("""
        DELETE FROM recent_view
        WHERE item_type = 'doc' AND item_id IN (
            SELECT page_id FROM canvas_page WHERE canvas_id = :canvas_id
        )
    """), {'canvas_id': canvas_id})
    await db.execute(text("""
        DELETE FROM user_star
        WHERE item_type = 'doc' AND item_id IN (
            SELECT page_id FROM canvas_page WHERE canvas_id = :canvas_id
        )
    """), {'canvas_id': canvas_id})
    await db.execute(text("""
        DELETE FROM canvas WHERE canvas_id = :canvas_id
    """), {'canvas_id': canvas_id})


async def find_public(user_id: int, query: str, db: AsyncSession):
    """public Canvas 목록 (가입 여부 포함)"""
    params = {'user_id': user_id}
    where_search = ''
    if query:
        where_search = "AND (c.canvas_name ILIKE :q OR c.key ILIKE :q)"
        params['q'] = f'%{query}%'

    result = await db.execute(text(f"""
        SELECT c.canvas_id, c.canvas_name, c.key, c.description,
               c.color, c.created_at,
               (SELECT COUNT(*) FROM canvas_member cm2
                WHERE cm2.canvas_id = c.canvas_id) AS member_count,
               EXISTS(
                   SELECT 1 FROM canvas_member cm3
                   WHERE cm3.canvas_id = c.canvas_id AND cm3.user_id = :user_id
               ) AS is_member
        FROM canvas c
        WHERE c.visibility = 'public'
          AND c.is_archived = FALSE
          {where_search}
        ORDER BY c.canvas_name
    """), params)
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]
