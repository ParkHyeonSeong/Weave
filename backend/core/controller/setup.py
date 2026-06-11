import bcrypt
from fastapi import Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from core.controller.auth import _create_token, _set_auth_cookie
from core.model import workspace as workspace_model
from core.model import user as user_model


async def check_initialized(db: AsyncSession):
    """초기화 상태 확인.

    이 엔드포인트는 미인증으로 노출된다. 초기화 전(미설정)에는 workspace_name /
    registration_policy 등 워크스페이스 메타데이터를 일절 흘리지 않고 initialized=False
    플래그만 반환한다(정보 노출 최소화). 초기화 후에는 프론트(Header 워크스페이스명 표시
    등)가 필요로 하므로 그대로 반환한다."""
    settings = await workspace_model.get_settings(db)
    if settings:
        return {
            'status': True,
            'initialized': True,
            'workspace_name': settings['workspace_name'],
            'registration_policy': settings['registration_policy'],
        }
    return {'status': True, 'initialized': False}


async def initialize(body, request: Request, response: Response, db: AsyncSession):
    """초기 설정 실행 (최초 1회).

    경합(TOCTOU) 가드: get_settings 사전 확인만으로는 동시 요청이 둘 다 "미초기화"로
    통과할 수 있다. 실제 단일 소유권은 workspace_settings 싱글톤(setting_id=1) INSERT
    가 결정한다 -- create_settings가 ON CONFLICT로 행을 삽입한 요청에만 True를 돌려준다.
    진 쪽은 방금 만든 관리자 user를 롤백해 버리고 ALREADY_INITIALIZED를 반환(500 아님)."""
    # 빠른 경로: 이미 초기화된 경우 차단 (권위적 가드는 아래 settings INSERT)
    existing = await workspace_model.get_settings(db)
    if existing:
        return {'status': False, 'message': 'ALREADY_INITIALIZED'}

    # 이메일 중복 체크
    existing_user = await user_model.find_by_email(body.email, db)
    if existing_user:
        return {'status': False, 'message': 'EMAIL_ALREADY_EXISTS'}

    # 관리자 계정 생성
    password_hash = bcrypt.hashpw(body.password.encode('utf-8'), bcrypt.gensalt())
    user_id = await user_model.create(body.email, password_hash, body.username, db)

    # admin 역할 부여
    await user_model.update_role(user_id, 'admin', db)

    # 워크스페이스 설정 저장 -- 원자적 경합 가드. 졌으면 user 생성까지 되돌리고 차단.
    created = await workspace_model.create_settings(
        workspace_name=body.workspace_name,
        registration_policy=body.registration_policy,
        admin_user_id=user_id,
        db=db,
    )
    if not created:
        await db.rollback()
        return {'status': False, 'message': 'ALREADY_INITIALIZED'}

    # 쿠키 발급
    token = _create_token(user_id, body.email, body.username, 'admin')
    _set_auth_cookie(response, token)

    return {
        'status': True,
        'profile': {
            'user_id': user_id,
            'email': body.email,
            'username': body.username,
            'role': 'admin',
        },
    }
