import os
import secrets

# Database
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://weave:weave@db:5432/weave",
)

# Alembic용 동기 URL (asyncpg -> psycopg 대신 간단하게 변환)
DATABASE_URL_SYNC = DATABASE_URL.replace("+asyncpg", "")

# JWT
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))

# App
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# Cookie
COOKIE_NAME = "weave_token"
COOKIE_SECURE = not DEBUG
COOKIE_SAMESITE = "lax"
COOKIE_HTTPONLY = True

# Encryption (SMTP 비밀번호 등 민감 데이터 암호화)
ENCRYPT_KEY = os.getenv("ENCRYPT_KEY", "")

# Web Push (VAPID)
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@weave.local")
