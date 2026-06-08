from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(name: str, icon: str | None, color: str, visibility: str,
                 retro_cadence: str, retro_interval_weeks: int | None,
                 retro_template: str, retro_anchor_weekday: int,
                 created_by: int, db: AsyncSession) -> int:
    """스크럼 보드 생성"""
    result = await db.execute(text("""
        INSERT INTO scrum_board (name, icon, color, visibility, retro_cadence,
                                 retro_interval_weeks, retro_template,
                                 retro_anchor_weekday, created_by)
        VALUES (:name, :icon, :color, :visibility, :retro_cadence,
                :retro_interval_weeks, :retro_template,
                :retro_anchor_weekday, :created_by)
        RETURNING board_id
    """), {
        'name': name, 'icon': icon, 'color': color, 'visibility': visibility,
        'retro_cadence': retro_cadence, 'retro_interval_weeks': retro_interval_weeks,
        'retro_template': retro_template, 'retro_anchor_weekday': retro_anchor_weekday,
        'created_by': created_by,
    })
    return result.scalar_one()


async def find_by_id(board_id: int, db: AsyncSession):
    """보드 상세 (아카이브 제외). 멤버십 체크는 controller."""
    result = await db.execute(text("""
        SELECT board_id, name, icon, color, visibility, retro_cadence,
               retro_interval_weeks, retro_template, retro_anchor_weekday,
               is_archived, created_by, created_at, updated_at
        FROM scrum_board
        WHERE board_id = :board_id AND is_archived = FALSE
    """), {'board_id': board_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_accessible(user_id: int, db: AsyncSession):
    """사용자가 멤버인 보드 목록 + 내 role + 멤버 수"""
    result = await db.execute(text("""
        SELECT b.board_id, b.name, b.icon, b.color, b.visibility, b.retro_cadence,
               b.retro_interval_weeks, b.retro_template, b.retro_anchor_weekday,
               b.created_at, b.updated_at,
               sm.role AS my_role,
               (SELECT COUNT(*) FROM scrum_member sm2 WHERE sm2.board_id = b.board_id) AS member_count
        FROM scrum_board b
        INNER JOIN scrum_member sm ON b.board_id = sm.board_id
        WHERE sm.user_id = :user_id AND b.is_archived = FALSE
        ORDER BY b.updated_at DESC NULLS LAST, b.created_at DESC
    """), {'user_id': user_id})
    return [dict(r._mapping) for r in result.fetchall()]


async def update(board_id: int, fields: dict, db: AsyncSession):
    """보드 수정 (동적 필드, 허용 목록만)"""
    allowed = {'name', 'icon', 'color', 'visibility', 'retro_cadence',
               'retro_interval_weeks', 'retro_template', 'retro_anchor_weekday'}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    set_parts = [f'{k} = :{k}' for k in updates]
    set_parts.append('updated_at = NOW()')
    set_clause = ', '.join(set_parts)
    params = {**updates, 'board_id': board_id}
    await db.execute(text(f"""
        UPDATE scrum_board SET {set_clause}
        WHERE board_id = :board_id
    """), params)


async def archive(board_id: int, db: AsyncSession):
    """소프트 삭제"""
    await db.execute(text("""
        UPDATE scrum_board SET is_archived = TRUE, updated_at = NOW()
        WHERE board_id = :board_id
    """), {'board_id': board_id})
