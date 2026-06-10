import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def find_by_type(type_id: int, db: AsyncSession):
    """Task type의 custom field 목록 (sort_order순)"""
    result = await db.execute(text("""
        SELECT custom_field_id, type_id, field_name, field_type,
               field_options, is_required, sort_order
        FROM custom_field
        WHERE type_id = :type_id
        ORDER BY sort_order, custom_field_id
    """), {'type_id': type_id})
    return [dict(row._mapping) for row in result.fetchall()]


async def find_by_id(custom_field_id: int, db: AsyncSession):
    """ID로 단일 조회"""
    result = await db.execute(text("""
        SELECT custom_field_id, type_id, field_name, field_type,
               field_options, is_required, sort_order
        FROM custom_field
        WHERE custom_field_id = :custom_field_id
    """), {'custom_field_id': custom_field_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def create(type_id: int, field_name: str, field_type: str,
                 field_options, is_required: bool, sort_order: int,
                 db: AsyncSession) -> int:
    """Custom field 생성"""
    result = await db.execute(text("""
        INSERT INTO custom_field (type_id, field_name, field_type, field_options,
                                  is_required, sort_order)
        VALUES (:type_id, :field_name, :field_type, :field_options,
                :is_required, :sort_order)
        RETURNING custom_field_id
    """), {
        'type_id': type_id,
        'field_name': field_name,
        'field_type': field_type,
        'field_options': json.dumps(field_options) if field_options else None,
        'is_required': is_required,
        'sort_order': sort_order,
    })
    return result.scalar_one()


async def update(custom_field_id: int, fields: dict, db: AsyncSession):
    """Custom field 수정"""
    if 'field_options' in fields and fields['field_options'] is not None:
        fields['field_options'] = json.dumps(fields['field_options'])
    sets = ', '.join(f'{k} = :{k}' for k in fields)
    fields['custom_field_id'] = custom_field_id
    await db.execute(text(f"""
        UPDATE custom_field SET {sets} WHERE custom_field_id = :custom_field_id
    """), fields)


async def delete(custom_field_id: int, db: AsyncSession):
    """Custom field 삭제"""
    await db.execute(text("""
        DELETE FROM custom_field WHERE custom_field_id = :custom_field_id
    """), {'custom_field_id': custom_field_id})


async def reorder(items: list, db: AsyncSession):
    """순서 변경 - items: CustomFieldReorderItem(id, sort_order) 리스트"""
    for item in items:
        await db.execute(text("""
            UPDATE custom_field SET sort_order = :sort_order
            WHERE custom_field_id = :id
        """), {'id': item.id, 'sort_order': item.sort_order})


async def count_ids_in_type(type_id: int, ids: list, db: AsyncSession) -> int:
    """ids 중 해당 type에 속하는 (중복 제거된) custom_field 수를 단일 쿼리로 반환.

    cross-branch IDOR 방어용 set-membership 체크. 호출부는 이 값을
    set(ids) 크기와 비교해 전부 type 소속인지 all-or-nothing 판정.
    """
    if not ids:
        return 0
    result = await db.execute(text("""
        SELECT COUNT(DISTINCT custom_field_id)
        FROM custom_field
        WHERE type_id = :type_id AND custom_field_id = ANY(:ids)
    """), {'type_id': type_id, 'ids': list(ids)})
    return result.scalar_one()
