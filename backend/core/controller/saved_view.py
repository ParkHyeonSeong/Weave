from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import saved_view as sv_model
from core.model import branch_member as member_model
from core.query.filter_spec import validate_filter, FilterError
from core.query.filter_db import validate_custom_fields

_EMPTY_GROUP = {'type': 'group', 'op': 'AND', 'negate': False, 'children': []}


async def _accessible(view, user_id, db) -> bool:
    """개인 뷰(scope NULL)=소유자만. 브랜치 뷰=현재 멤버 AND (소유자 OR shared).
    리뷰 반영: owner여도 브랜치 멤버십을 재확인(탈퇴/제거 시 자동 회수). 멤버 제거는 branch_member만
    지우므로(branch.py), 멤버십 재확인이 없으면 전 멤버가 view_id로 계속 접근 가능."""
    if view['scope_branch_id'] is None:
        return view['owner_user_id'] == user_id
    if not await member_model.is_member(view['scope_branch_id'], user_id, db):
        return False
    return view['owner_user_id'] == user_id or view['visibility'] == 'shared'


async def _validate_spec(filter_spec, scope_branch_id, db):
    """저장 시점 FilterSpec 검증 + {} 정규화. OK면 (정규화 spec, None), 실패면 (None, error dict).
    scope_branch_id로 cf 소속 검증(개인 뷰(NULL)의 cf 조건은 FilterError로 거부)."""
    # None/{} 같은 falsy만 빈 그룹으로 정규화. group/cond 루트 spec은 보존(둘 다 유효 — validate_filter가 검증).
    # (type=='group' 강제 정규화는 유효한 cond 루트를 조용히 '전체'로 날림 → 금지)
    spec = filter_spec if filter_spec else dict(_EMPTY_GROUP)
    try:
        validate_filter(spec)
        await validate_custom_fields(spec, scope_branch_id, db)
    except FilterError as e:
        return None, error_response(ErrorCode.INVALID_FILTER, detail=str(e))
    return spec, None


async def create(body, request: Request, db: AsyncSession):
    user_id = request.state.payload.get('user_id')
    if body.scope_branch_id is not None and not await member_model.is_member(body.scope_branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)
    if body.visibility not in ('private', 'shared'):
        return error_response(ErrorCode.INVALID_VISIBILITY)
    if body.visibility == 'shared' and body.scope_branch_id is None:
        return error_response(ErrorCode.VIEW_SCOPE_MISMATCH)  # 개인(scope NULL) 뷰는 공유 불가
    if body.scope is not None:
        if body.scope not in ('my', 'all'):
            return error_response(ErrorCode.INVALID_SCOPE)           # 잘못된 값
        if body.scope_branch_id is not None:
            return error_response(ErrorCode.VIEW_SCOPE_MISMATCH)     # scope는 개인(크로스) 뷰 전용(리뷰 P2)
    spec, err = await _validate_spec(body.filter_spec, body.scope_branch_id, db)
    if err:
        return err
    view_id = await sv_model.create(user_id, body.scope_branch_id, body.name, spec,
                                    body.group_by, body.sort, body.columns, body.visibility, db,
                                    scope=body.scope)
    return {'status': True, 'view_id': view_id}


async def get_list(scope_branch_id, request: Request, db: AsyncSession):
    user_id = request.state.payload.get('user_id')
    if scope_branch_id is not None and not await member_model.is_member(scope_branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)
    views = await sv_model.find_accessible(user_id, scope_branch_id, db)
    return {'status': True, 'views': views}


async def get_detail(view_id: int, request: Request, db: AsyncSession):
    user_id = request.state.payload.get('user_id')
    view = await sv_model.find_by_id(view_id, db)
    if not view:
        return error_response(ErrorCode.VIEW_NOT_FOUND)
    if not await _accessible(view, user_id, db):
        return error_response(ErrorCode.NOT_VIEW_VISIBLE)
    return {'status': True, 'view': view}


async def _owner_and_member(view_id, user_id, db):
    """소유자 AND (브랜치 뷰면 현재 멤버). OK면 (view, None), 아니면 (None, error dict)."""
    view = await sv_model.find_by_id(view_id, db)
    if not view:
        return None, error_response(ErrorCode.VIEW_NOT_FOUND)
    if view['owner_user_id'] != user_id:
        return None, error_response(ErrorCode.NOT_VIEW_OWNER)
    if view['scope_branch_id'] is not None and not await member_model.is_member(view['scope_branch_id'], user_id, db):
        return None, error_response(ErrorCode.NOT_BRANCH_MEMBER)  # 탈퇴한 owner의 변경 차단
    return view, None


async def update(view_id: int, body, request: Request, db: AsyncSession):
    user_id = request.state.payload.get('user_id')
    view, err = await _owner_and_member(view_id, user_id, db)
    if err:
        return err
    # exclude_unset: 명시적으로 보낸 필드만(explicit null 보존). group_by=None을 살려 '그룹핑 해제'가
    # 동작하게 한다(exclude_none은 null을 버려 기존 group_by가 남는 버그 — 리뷰 P1).
    fields = body.model_dump(exclude_unset=True)
    # NOT NULL 컬럼(name/filter_spec/visibility)의 explicit null은 무시(DB 제약 위반·의미 없음).
    # nullable인 group_by/sort/columns만 null 클리어를 허용.
    for nn in ('name', 'filter_spec', 'visibility'):
        if nn in fields and fields[nn] is None:
            del fields[nn]
    if 'visibility' in fields and fields['visibility'] not in ('private', 'shared'):
        return error_response(ErrorCode.INVALID_VISIBILITY)  # create()와 대칭(잘못된 enum 거부)
    if fields.get('visibility') == 'shared' and view['scope_branch_id'] is None:
        return error_response(ErrorCode.VIEW_SCOPE_MISMATCH)
    if 'scope' in fields and fields['scope'] is not None:
        if fields['scope'] not in ('my', 'all'):
            return error_response(ErrorCode.INVALID_SCOPE)          # create와 대칭(잘못된 값)
        if view['scope_branch_id'] is not None:
            return error_response(ErrorCode.VIEW_SCOPE_MISMATCH)    # 브랜치 뷰엔 scope 설정 불가(리뷰 P2)
    if 'filter_spec' in fields:  # 저장 시점 재검증 + 정규화
        spec, verr = await _validate_spec(fields['filter_spec'], view['scope_branch_id'], db)
        if verr:
            return verr
        fields['filter_spec'] = spec
    await sv_model.update(view_id, fields, db)
    return {'status': True}


async def delete(view_id: int, request: Request, db: AsyncSession):
    user_id = request.state.payload.get('user_id')
    _, err = await _owner_and_member(view_id, user_id, db)
    if err:
        return err
    await sv_model.delete(view_id, db)
    return {'status': True}
