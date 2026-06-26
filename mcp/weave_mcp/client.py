import httpx

from . import errors as E
from .config import Settings, get_settings


def _retry_after(resp):
    """Parse a Retry-After header to non-negative int seconds, else None.

    Weave's 429 handler sends no Retry-After today, so this is usually None. Non-numeric
    forms (HTTP-date, negative, junk) are dropped to None to keep retry_after a clean int|None.
    """
    raw = (resp.headers.get("Retry-After") or "").strip()
    if not raw.isdigit():
        return None
    return int(raw)


class WeaveClient:
    """Authenticated HTTP client for Weave's REST API using a Personal Access Token.

    The token is sent as an ``Authorization: Bearer`` header on every request. PATs are
    long-lived, so there is no login, cookie, session, or refresh logic — an invalid or
    revoked token yields a 401, surfaced by ``call_json`` as
    ``{"error": {"category": "auth", ...}}`` (distinct from a forbidden resource, whose
    category is ``"forbidden"``) so a dead token can be detected without retrying every tool.
    """

    def __init__(self, settings: Settings | None = None):
        self._settings = settings or get_settings()
        headers = {}
        if self._settings.token:
            headers["Authorization"] = f"Bearer {self._settings.token}"
        # Granular timeouts: fail a stuck connect fast, but allow long reads for big
        # list/search payloads. retries=2 only retries idempotent connect-level failures
        # (a transient reset/DNS blip), never a received HTTP error response.
        timeout = httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0)
        self._http = httpx.AsyncClient(
            base_url=self._settings.base_url,
            timeout=timeout,
            headers=headers,
            transport=httpx.AsyncHTTPTransport(retries=2),
        )

    async def call(self, method: str, path: str, **kwargs) -> httpx.Response:
        return await self._http.request(method, path, **kwargs)

    async def call_json(self, method: str, path: str, **kwargs):
        """Call the API; return raw body on success, a nested error envelope on failure.

        Failure shape (SP-3): {"error": {category, code, message, http_status,
        retryable, retry_after, detail?}}. Success returns the parsed body (dict|list|
        scalar) unchanged, or {"text": ...} for a 2xx non-JSON/empty body. Tools never
        raise into the MCP layer; an unexpected tool exception is absorbed by the
        on_call_tool middleware as a structured `server` error.
        """
        if not self._settings.token:
            return E.make_error("auth", code=E.TOKEN_NOT_SET,
                                message="WEAVE_API_TOKEN is not set")
        try:
            resp = await self.call(method, path, **kwargs)
        except httpx.HTTPError as exc:
            return E.make_error("network", message=str(exc), detail=str(exc))

        retry_after = _retry_after(resp)

        if resp.is_success:
            try:
                body = resp.json()
            except ValueError:
                return {"text": resp.text}            # 2xx non-JSON / 204 — success marker
            if isinstance(body, dict):
                if body.get("status") is False:
                    return E.error_from_body(body, 200, retry_after=retry_after)
                # Contract: a successful payload never carries a top-level "error" field.
                # A present, non-null "error" on a 2xx body is a failure marker — normalize it.
                if body.get("error") is not None:
                    return E.normalize_embedded(body, 200)
            return body                                # list / scalar / ok-dict — raw success

        # non-2xx
        try:
            body = resp.json()
        except ValueError:
            body = None
        if isinstance(body, dict) and (
            body.get("category") or body.get("code")
            or body.get("message") or body.get("status") is False
        ):
            return E.error_from_body(body, resp.status_code, retry_after=retry_after)
        detail = body.get("detail") if isinstance(body, dict) else (resp.text or None)
        return E.error_from_status(resp.status_code, detail=detail, retry_after=retry_after)

    async def aclose(self) -> None:
        await self._http.aclose()
