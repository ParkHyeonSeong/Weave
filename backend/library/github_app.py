"""GitHub App 연동 라이브러리.

- verify_signature: 웹훅 X-Hub-Signature-256(HMAC-SHA256) 상수시간 검증.
- app_jwt: App private key(RS256)로 단기 App JWT 서명.
- installation_token: App JWT로 installation access token을 온디맨드 민팅, 응답의
  expires_at 기준으로 메모리 캐시(토큰 비저장).

토큰/시크릿은 DB에 저장하지 않는다. 외부 호출은 installation_token 뿐이며,
자동 전이 경로(웹훅)는 외부 호출이 필요 없다.
"""
import hashlib
import hmac
import time

import jwt

import config


def verify_signature(secret: str, raw_body: bytes, signature_header: str) -> bool:
    """X-Hub-Signature-256 검증. 'sha256='+HMAC_SHA256(secret, raw_body) 와 상수시간 비교.

    - secret이 비어있으면(미설정) 항상 False — fail closed.
    - signature_header가 없거나 'sha256=' 스킴이 아니면 False (레거시 sha1= 거부).
    - 반드시 raw_body(JSON 파싱 전 바이트)로 계산해야 한다.
    """
    if not secret or not signature_header:
        return False
    if not signature_header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(
        secret.encode(), raw_body, hashlib.sha256
    ).hexdigest()
    # 타이밍 사이드채널 방지 — '==' 금지(레포 전역 미사용 신규 도입).
    return hmac.compare_digest(expected, signature_header)


def app_jwt() -> str:
    """App private key로 RS256 서명한 단기 App JWT를 만든다.

    iss=GITHUB_APP_ID, iat는 시계 스큐 흡수용 -60초, exp는 GitHub 상한(10분) 내인 +9분.
    이 JWT는 /app/installations/{id}/access_tokens 호출의 Bearer로만 쓴다.
    """
    if not config.GITHUB_APP_PRIVATE_KEY:
        raise RuntimeError("GITHUB_APP_PRIVATE_KEY is not configured")
    now = int(time.time())
    payload = {
        "iss": config.GITHUB_APP_ID,
        "iat": now - 60,   # 시계 스큐 흡수(future-iat 거부 회피)
        "exp": now + 540,  # 9분 < GitHub 10분 상한
    }
    return jwt.encode(payload, config.GITHUB_APP_PRIVATE_KEY, algorithm="RS256")
