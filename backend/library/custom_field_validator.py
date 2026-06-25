"""custom_fields 쓰기 값 검증.

custom_field는 task_type(type_id)에 속하며 값은 task.custom_fields JSONB에
bare field-id 문자열 키로 저장된다(예: {"12": 42}). 네이티브 타입 보존.
strict=True: 모르는 키 거부 + 타입 불일치 거부 (신규 per-key 도구).
strict=False: 모르는 키 통과, 알려진 키의 타입 불일치만 거부 (update/create replace).
null 값은 항상 허용(=clear).
"""
import datetime
import json

from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import ErrorCode
from core.model import custom_field as custom_field_model


def _type_ok(field_type: str, value) -> bool:
    if value is None:
        return True
    if field_type == 'number':
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if field_type == 'checkbox':
        return isinstance(value, bool)
    if field_type == 'date':
        if not isinstance(value, str):
            return False
        try:
            datetime.date.fromisoformat(value)
            return True
        except ValueError:
            return False
    # text, url, select → 문자열 (select은 옵션 멤버십을 호출부에서 추가 검증)
    return isinstance(value, str)


async def validate_custom_field_values(type_id: int, values, db: AsyncSession, *, strict: bool):
    """검증 통과 시 None, 실패 시 ErrorCode.INVALID_CUSTOM_FIELD 반환."""
    if not values:
        return None
    defs = await custom_field_model.find_by_type(type_id, db)
    by_id = {str(d['custom_field_id']): d for d in defs}
    for key, value in values.items():
        d = by_id.get(str(key))
        if d is None:
            if strict:
                return ErrorCode.INVALID_CUSTOM_FIELD
            continue  # lenient: 모르는 키 무시
        if not _type_ok(d['field_type'], value):
            return ErrorCode.INVALID_CUSTOM_FIELD
        if d['field_type'] == 'select' and value is not None:
            options = d.get('field_options') or []
            if isinstance(options, str):  # JSONB는 보통 list지만 문자열로 와도 방어
                options = json.loads(options)
            if value not in options:
                return ErrorCode.INVALID_CUSTOM_FIELD
    return None
