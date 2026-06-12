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

# Frontend base URL — 비밀번호 재설정 링크 등 절대 URL 구성용.
# 미설정 시 백엔드는 토큰 + 상대경로만 반환하고 프론트가 절대 URL을 구성한다.
FRONTEND_URL = os.getenv("FRONTEND_URL", "").rstrip("/")

# 비밀번호 재설정 토큰 만료 (시간)
PASSWORD_RESET_TOKEN_EXPIRE_HOURS = int(os.getenv("PASSWORD_RESET_TOKEN_EXPIRE_HOURS", "1"))

# Web Push (VAPID)
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@weave.local")

# WebSocket 협업 메시지 최대 크기(바이트). Yjs 업데이트/동기화는 바이너리 CRDT 인코딩이며
# 증분 업데이트는 보통 수 KB 수준이지만, 대형 프레임 반복으로 인한 메모리/CPU 고갈(DoS)을
# 막기 위해 앱 레벨 상한을 둔다(SEC-20).
# uvicorn 기본 ws_max_size(16MB)보다 보수적으로 잡되 큰 문서 초기 동기화는 통과하도록 여유.
WS_MAX_MESSAGE_BYTES = int(os.getenv("WS_MAX_MESSAGE_BYTES", str(2 * 1024 * 1024)))

# WebSocket 협업 연결의 멤버십 재검증 주기(초). 핸드셰이크 후 제거된 멤버가 편집 세션을
# 유지하지 못하도록 수신 메시지마다(스로틀) 멤버십을 재확인한다(LOG-03).
WS_MEMBERSHIP_RECHECK_SECS = int(os.getenv("WS_MEMBERSHIP_RECHECK_SECS", "30"))
