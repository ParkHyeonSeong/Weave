"""
Fernet 대칭 암호화 유틸리티
ENCRYPT_KEY 환경변수 기반으로 민감 데이터(SMTP 비밀번호 등) 암호화/복호화
"""
import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from config import ENCRYPT_KEY

logger = logging.getLogger("weave.crypto")


def _derive_key(secret: str) -> bytes:
    """임의 길이 문자열에서 Fernet 호환 32-byte base64 키 유도"""
    raw = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(raw)


def _get_fernet() -> Fernet | None:
    if not ENCRYPT_KEY:
        return None
    return Fernet(_derive_key(ENCRYPT_KEY))


def encrypt(plain: str) -> str:
    """평문 -> 암호문. ENCRYPT_KEY 미설정 시 평문 그대로 반환"""
    f = _get_fernet()
    if not f:
        logger.warning("ENCRYPT_KEY not set — storing value as plaintext")
        return plain
    return f.encrypt(plain.encode()).decode()


def decrypt(token: str) -> str:
    """암호문 -> 평문. ENCRYPT_KEY 미설정이거나 복호화 실패 시 원본 반환 (평문 호환)"""
    f = _get_fernet()
    if not f:
        return token
    try:
        return f.decrypt(token.encode()).decode()
    except InvalidToken:
        # 기존 평문 데이터 호환 — 암호화되지 않은 값이면 그대로 반환
        return token
