"""
Fernet 대칭 암호화 유틸리티
ENCRYPT_KEY 환경변수 기반으로 민감 데이터(SMTP 비밀번호 등) 암호화/복호화
"""
import base64
import bcrypt
import hashlib
import hmac
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


def hash_token(raw: str) -> str:
    """One-way hash for PATs. HMAC-SHA256 peppered with ENCRYPT_KEY when set,
    plain SHA-256 otherwise (dev fallback). Deterministic — same input → same digest,
    so it can be used both to store and to look up tokens."""
    if ENCRYPT_KEY:
        key = _derive_key(ENCRYPT_KEY)  # 32-byte urlsafe-b64 key, reused from Fernet derivation
        return hmac.new(key, raw.encode(), hashlib.sha256).hexdigest()
    logger.warning("ENCRYPT_KEY not set — hashing PAT without pepper (sha256)")
    return hashlib.sha256(raw.encode()).hexdigest()


# ── 비밀번호 정책/해싱 ──────────────────────────────────────────────
MIN_PASSWORD_LENGTH = 8  # 모든 비밀번호 설정 경로가 공유하는 최소 길이 단일 소스


def hash_password(plain: str, rounds: int = 12) -> bytes:
    """비밀번호 bcrypt 해싱 (cost=12).

    기존 cost=10 해시는 checkpw가 해시에 embed된 cost로 그대로 검증하므로 호환된다 —
    신규 비밀번호만 cost=12로 점진 강화한다. cost 조정이 필요하면 이 함수 한 곳만 바꾸면 된다."""
    return bcrypt.hashpw(plain.encode('utf-8'), bcrypt.gensalt(rounds=rounds))
