import secrets
import asyncio
import bcrypt
import logging
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("weave.admin")

from core.model import user as user_model
from core.model import smtp_config as smtp_config_model
from library import smtp_client


async def create_user(body, request: Request, db: AsyncSession):
    """관리자가 수동으로 사용자 생성"""
    existing = await user_model.find_by_email(body.email, db)
    if existing:
        return {'status': False, 'message': 'EMAIL_ALREADY_EXISTS'}

    password_hash = bcrypt.hashpw(body.password.encode('utf-8'), bcrypt.gensalt())
    user_id = await user_model.create(body.email, password_hash, body.username, db)

    if body.role == 'admin':
        await user_model.update_role(user_id, 'admin', db)

    return {'status': True, 'user_id': user_id}


async def list_users(request: Request, db: AsyncSession):
    """전체 사용자 목록 조회"""
    users = await user_model.find_all(db)
    return {'status': True, 'users': users}


async def update_user_role(user_id: int, body, request: Request, db: AsyncSession):
    """사용자 역할 변경"""
    admin_id = request.state.payload.get('user_id')

    # 자기 자신의 역할은 변경 불가
    if user_id == admin_id:
        return {'status': False, 'message': 'CANNOT_CHANGE_OWN_ROLE'}

    target = await user_model.find_by_id(user_id, db)
    if not target:
        return {'status': False, 'message': 'USER_NOT_FOUND'}

    await user_model.update_role(user_id, body.role, db)
    return {'status': True}


async def update_user_status(user_id: int, body, request: Request, db: AsyncSession):
    """사용자 상태 변경 (승인/거부)"""
    admin_id = request.state.payload.get('user_id')

    # 자기 자신의 상태는 변경 불가
    if user_id == admin_id:
        return {'status': False, 'message': 'CANNOT_CHANGE_OWN_STATUS'}

    target = await user_model.find_by_id(user_id, db)
    if not target:
        return {'status': False, 'message': 'USER_NOT_FOUND'}

    await user_model.update_status(user_id, body.status, db)
    return {'status': True}


async def reset_user_password(user_id: int, body, request: Request, db: AsyncSession):
    """사용자 비밀번호 초기화"""
    admin_id = request.state.payload.get('user_id')

    # 자기 자신의 비밀번호는 초기화 불가
    if user_id == admin_id:
        return {'status': False, 'message': 'CANNOT_RESET_OWN_PASSWORD'}

    target = await user_model.find_by_id(user_id, db)
    if not target:
        return {'status': False, 'message': 'USER_NOT_FOUND'}

    # 비밀번호 생성 (미지정 시 자동 생성)
    plain_password = body.new_password if body.new_password else secrets.token_urlsafe(9)
    password_hash = bcrypt.hashpw(plain_password.encode('utf-8'), bcrypt.gensalt())

    await user_model.update_password(user_id, password_hash, db)
    await user_model.set_must_change_password(user_id, True, db)

    # SMTP 설정이 있으면 이메일 발송
    smtp_config = await smtp_config_model.get_config_for_sending(db)
    if smtp_config:
        email_html = f"""
        <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:32px;">
            <h2 style="color:#5E6AD2;margin-bottom:16px;">Password Reset</h2>
            <p style="color:#333;line-height:1.6;">
                Your password has been reset by an administrator.<br>
                Please use the temporary password below to log in.
            </p>
            <div style="background:#F5F5F5;border-radius:8px;padding:16px;margin:20px 0;text-align:center;">
                <code style="font-size:18px;font-weight:bold;color:#333;letter-spacing:1px;">{plain_password}</code>
            </div>
            <p style="color:#333;line-height:1.6;">
                You will be required to change your password on your next login.
            </p>
            <hr style="border:none;border-top:1px solid #E5E5E5;margin:24px 0;">
            <p style="color:#999;font-size:12px;">Sent from Weave</p>
        </div>
        """
        try:
            asyncio.create_task(
                smtp_client.send_email(smtp_config, [target['email']],
                                       "Weave - Your password has been reset", email_html)
            )
            return {'status': True, 'email_sent': True}
        except Exception as e:
            logger.error("Failed to send reset email: %s", e)
            return {'status': True, 'temporary_password': plain_password, 'email_sent': False}

    return {'status': True, 'temporary_password': plain_password, 'email_sent': False}


# ── SMTP 설정 ────────────────────────────────────────────────────────────

async def get_smtp_config(request: Request, db: AsyncSession):
    """SMTP 설정 조회"""
    config = await smtp_config_model.get_config(db)
    if not config:
        return {'status': True, 'config': None}
    return {'status': True, 'config': config}


async def save_smtp_config(body, request: Request, db: AsyncSession):
    """SMTP 설정 저장"""
    admin_id = request.state.payload.get('user_id')
    config = await smtp_config_model.upsert_config(
        smtp_host=body.smtp_host,
        smtp_port=body.smtp_port,
        smtp_user=body.smtp_user,
        smtp_password=body.smtp_password,
        sender_email=body.sender_email,
        sender_name=body.sender_name,
        use_tls=body.use_tls,
        updated_by=admin_id,
        db=db,
    )
    if not config:
        return {'status': False, 'message': 'SMTP_PASSWORD_REQUIRED'}
    return {'status': True, 'config': config}


async def test_smtp(body, request: Request, db: AsyncSession):
    """SMTP 테스트 이메일 발송"""
    config = await smtp_config_model.get_config_for_sending(db)
    if not config:
        return {'status': False, 'message': 'SMTP_NOT_CONFIGURED'}

    result = await smtp_client.send_test_email(config, body.test_email)
    return result


# ── 사용자 삭제 ──────────────────────────────────────────────────────────

async def delete_user(user_id: int, request: Request, db: AsyncSession):
    """사용자 소프트 삭제"""
    admin_id = request.state.payload.get('user_id')

    if user_id == admin_id:
        return {'status': False, 'message': 'CANNOT_DELETE_SELF'}

    target = await user_model.find_by_id(user_id, db)
    if not target:
        return {'status': False, 'message': 'USER_NOT_FOUND'}

    await user_model.soft_delete(user_id, db)
    return {'status': True}
