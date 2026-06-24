import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_JSON_COLS = ('filter_spec', 'sort', 'columns')


def _row(row) -> dict:
    d = dict(row._mapping)
    for c in _JSON_COLS:
        if c in d and isinstance(d[c], str):  # asyncpg 보통 dict로 주지만 방어
            d[c] = json.loads(d[c]) if d[c] else None
    return d


async def create(owner_user_id, scope_branch_id, name, filter_spec, group_by,
                 sort, columns, visibility, db: AsyncSession) -> int:
    result = await db.execute(text("""
        INSERT INTO saved_view (owner_user_id, scope_branch_id, name, filter_spec,
                                group_by, sort, columns, visibility)
        VALUES (:owner, :scope, :name, CAST(:filter_spec AS jsonb), :group_by,
                CAST(:sort AS jsonb), CAST(:columns AS jsonb), :visibility)
        RETURNING view_id
    """), {
        'owner': owner_user_id, 'scope': scope_branch_id, 'name': name,
        'filter_spec': json.dumps(filter_spec or {}),
        'group_by': group_by,
        'sort': json.dumps(sort) if sort is not None else None,
        'columns': json.dumps(columns) if columns is not None else None,
        'visibility': visibility,
    })
    return result.scalar_one()


async def find_by_id(view_id: int, db: AsyncSession):
    result = await db.execute(text("""
        SELECT view_id, owner_user_id, scope_branch_id, name, filter_spec,
               group_by, sort, columns, visibility, created_at, updated_at
        FROM saved_view WHERE view_id = :id
    """), {'id': view_id})
    row = result.fetchone()
    return _row(row) if row else None


async def find_accessible(user_id: int, scope_branch_id, db: AsyncSession):
    """Global 접근 계약과 동일하게 자기완결적: 브랜치 뷰=현재 멤버 AND (owner OR shared),
    개인 뷰(scope IS NULL)=owner만. owner여도 브랜치 멤버십을 요구한다(탈퇴/제거 시 자동 회수).
    컨트롤러가 멤버십을 선검사하지만, 함수명이 find_accessible이므로 직접 호출도 계약을 지키게 둔다."""
    if scope_branch_id is None:
        result = await db.execute(text("""
            SELECT view_id, owner_user_id, scope_branch_id, name, filter_spec,
                   group_by, sort, columns, visibility, created_at, updated_at,
                   (owner_user_id = :uid) AS is_owner
            FROM saved_view
            WHERE scope_branch_id IS NULL AND owner_user_id = :uid
            ORDER BY name
        """), {'uid': user_id})
    else:
        # 멤버십을 owner/shared 공통 전제로 끌어올림(EXISTS를 OR 밖에). owner여도 멤버 아니면 안 보임.
        result = await db.execute(text("""
            SELECT sv.view_id, sv.owner_user_id, sv.scope_branch_id, sv.name, sv.filter_spec,
                   sv.group_by, sv.sort, sv.columns, sv.visibility, sv.created_at, sv.updated_at,
                   (sv.owner_user_id = :uid) AS is_owner
            FROM saved_view sv
            WHERE sv.scope_branch_id = :bid
              AND EXISTS (SELECT 1 FROM branch_member bm
                          WHERE bm.branch_id = sv.scope_branch_id AND bm.user_id = :uid)
              AND (sv.owner_user_id = :uid OR sv.visibility = 'shared')
            ORDER BY sv.name
        """), {'uid': user_id, 'bid': scope_branch_id})
    return [_row(r) for r in result.fetchall()]


async def update(view_id: int, fields: dict, db: AsyncSession):
    sets, params = [], {'id': view_id}
    for col in ('name', 'group_by', 'visibility'):
        if col in fields:
            sets.append(f"{col} = :{col}"); params[col] = fields[col]
    for col in ('filter_spec', 'sort', 'columns'):
        if col in fields:
            sets.append(f"{col} = CAST(:{col} AS jsonb)"); params[col] = json.dumps(fields[col])
    if not sets:
        return
    sets.append("updated_at = now()")
    await db.execute(text(f"UPDATE saved_view SET {', '.join(sets)} WHERE view_id = :id"), params)


async def delete(view_id: int, db: AsyncSession):
    await db.execute(text("DELETE FROM saved_view WHERE view_id = :id"), {'id': view_id})
