from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(track_name: str, description: str, color: str, icon: str,
                 visibility: str, default_view: str, created_by: int,
                 db: AsyncSession) -> int:
    """Track 생성"""
    result = await db.execute(text("""
        INSERT INTO track (track_name, description, color, icon, visibility,
                           default_view, created_by)
        VALUES (:track_name, :description, :color, :icon, :visibility,
                :default_view, :created_by)
        RETURNING track_id
    """), {
        'track_name': track_name,
        'description': description,
        'color': color,
        'icon': icon,
        'visibility': visibility,
        'default_view': default_view,
        'created_by': created_by,
    })
    return result.scalar_one()


async def find_by_id(track_id: int, db: AsyncSession):
    """Track 상세 (생성자만, 멤버 체크는 controller에서)"""
    result = await db.execute(text("""
        SELECT track_id, track_name, description, color, icon, visibility,
               default_view, is_archived, created_by, created_at, updated_at
        FROM track
        WHERE track_id = :track_id AND is_archived = FALSE
    """), {'track_id': track_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_accessible(user_id: int, db: AsyncSession):
    """사용자가 멤버인 Track 목록 (item/branch 카운트 포함)"""
    result = await db.execute(text("""
        SELECT t.track_id, t.track_name, t.description, t.color, t.icon,
               t.visibility, t.default_view, t.created_at, t.updated_at,
               tm.role AS my_role,
               (SELECT COUNT(*) FROM track_item ti WHERE ti.track_id = t.track_id) AS item_count,
               (SELECT COUNT(*) FROM track_branch tb WHERE tb.track_id = t.track_id) AS branch_count,
               (SELECT COUNT(*) FROM track_member tm2 WHERE tm2.track_id = t.track_id) AS member_count
        FROM track t
        INNER JOIN track_member tm ON t.track_id = tm.track_id
        WHERE tm.user_id = :user_id AND t.is_archived = FALSE
        ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC
    """), {'user_id': user_id})
    return [dict(r._mapping) for r in result.fetchall()]


async def update(track_id: int, fields: dict, db: AsyncSession):
    """Track 정보 수정 (동적 필드)"""
    allowed = {'track_name', 'description', 'color', 'icon', 'visibility', 'default_view'}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    set_parts = [f'{k} = :{k}' for k in updates]
    set_parts.append('updated_at = NOW()')
    set_clause = ', '.join(set_parts)
    params = {**updates, 'track_id': track_id}
    await db.execute(text(f"""
        UPDATE track SET {set_clause}
        WHERE track_id = :track_id
    """), params)


async def archive(track_id: int, db: AsyncSession):
    """Track 아카이브 (soft delete)"""
    await db.execute(text("""
        UPDATE track SET is_archived = TRUE, updated_at = NOW()
        WHERE track_id = :track_id
    """), {'track_id': track_id})
