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
from datetime import datetime, timezone

import httpx
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
    if not signature_header.isascii():
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


GITHUB_API_BASE = "https://api.github.com"

# installation_id -> {"token": str, "expires_at": datetime(tz-aware)}.
# 토큰은 DB에 저장하지 않는다 — 프로세스 메모리에만 캐시하고 만료 임박 시 재발급.
_token_cache: dict[int, dict] = {}

# 만료 임박 재발급 여유(초). 응답 expires_at이 지금+이 값 이내면 캐시 미스로 본다.
_TOKEN_REFRESH_SKEW_SECONDS = 60


def _github_client() -> httpx.AsyncClient:
    """httpx 클라이언트 팩토리(테스트가 MockTransport를 주입하는 seam)."""
    return httpx.AsyncClient(base_url=GITHUB_API_BASE, timeout=10.0)


def _parse_expires_at(value: str) -> datetime:
    """GitHub의 ISO8601 expires_at("...Z")를 tz-aware datetime으로 파싱."""
    # "2026-06-26T12:00:00Z" -> fromisoformat은 'Z'를 직접 못 읽으므로 +00:00로 치환.
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


async def installation_token(installation_id: int) -> str:
    """installation access token을 발급/캐시한다.

    캐시에 유효(만료까지 _TOKEN_REFRESH_SKEW_SECONDS 초과)한 토큰이 있으면 재사용,
    없으면 App JWT(Bearer)로 POST /app/installations/{id}/access_tokens 해서 새로 민팅하고
    응답의 expires_at 기준으로 캐시한다(평면 60분 가정 금지).
    """
    now = datetime.now(timezone.utc)
    cached = _token_cache.get(installation_id)
    if cached and (cached["expires_at"] - now).total_seconds() > _TOKEN_REFRESH_SKEW_SECONDS:
        return cached["token"]

    async with _github_client() as client:
        resp = await client.post(
            f"/app/installations/{installation_id}/access_tokens",
            headers={
                "Authorization": f"Bearer {app_jwt()}",
                "Accept": "application/vnd.github+json",
            },
        )
        resp.raise_for_status()
        data = resp.json()

    _token_cache[installation_id] = {
        "token": data["token"],
        "expires_at": _parse_expires_at(data["expires_at"]),
    }
    return data["token"]


async def fetch_pull_request(owner: str, repo: str, number: int, installation_id: int):
    """수동 링크용 PR 메타 조회. installation token으로 GET /repos/{o}/{r}/pulls/{n}.
    200이면 PR JSON(dict), 아니면 None. 자동 webhook 경로는 쓰지 않는다(payload 자기완결)."""
    token = await installation_token(installation_id)
    async with _github_client() as client:
        resp = await client.get(
            f"https://api.github.com/repos/{owner}/{repo}/pulls/{number}",
            headers={"Authorization": f"Bearer {token}",
                     "Accept": "application/vnd.github+json"},
        )
    if resp.status_code != 200:
        return None
    return resp.json()
