import os
import secrets

# Database
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://weave:weave@db:5432/weave",
)

# Alembic용 동기 URL (asyncpg -> psycopg 대신 간단하게 변환)
DATABASE_URL_SYNC = DATABASE_URL.replace("+asyncpg", "")

# App
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# JWT — 프로덕션에서 미설정 시 멀티워커 환경에서 인증 깨짐 방지
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
if not JWT_SECRET_KEY:
    if DEBUG:
        JWT_SECRET_KEY = secrets.token_hex(32)
    else:
        raise RuntimeError("JWT_SECRET_KEY must be set (export JWT_SECRET_KEY=...)")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))

# Cookie
COOKIE_NAME = "weave_token"
COOKIE_SECURE = not DEBUG
COOKIE_SAMESITE = "lax"
COOKIE_HTTPONLY = True

# Encryption — 프로덕션에서 미설정 시 민감 데이터 평문 저장 방지
ENCRYPT_KEY = os.getenv("ENCRYPT_KEY", "")
if not ENCRYPT_KEY:
    if DEBUG:
        ENCRYPT_KEY = "dev-only-encrypt-key"
    else:
        raise RuntimeError("ENCRYPT_KEY must be set (export ENCRYPT_KEY=...)")

# Web Push (VAPID)
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@weave.local")
