import httpx

from .config import Settings, get_settings


class WeaveClient:
    """Authenticated HTTP client for Weave's REST API using a Personal Access Token.

    The token is sent as an ``Authorization: Bearer`` header on every request. PATs are
    long-lived, so there is no login, cookie, session, or refresh logic — an invalid or
    revoked token yields a 401, surfaced by ``call_json`` as ``{"error": "auth"}`` (distinct
    from a forbidden resource) so a dead token can be detected without retrying every tool.
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
        """Call the API and return a JSON-friendly result.

        On success returns the parsed body (dict or list). On any failure — HTTP
        error, network error, missing token, OR a business rejection the backend
        returns as HTTP 200 + ``{"status": False}`` — returns a dict with an
        "error" key so tools never raise into the MCP layer and never report a
        rejected action as success.
        """
        if not self._settings.token:
            return {"error": "auth", "detail": "WEAVE_API_TOKEN is not set"}
        try:
            resp = await self.call(method, path, **kwargs)
        except httpx.HTTPError as exc:
            return {"error": "network", "detail": str(exc)}

        if resp.is_success:
            try:
                body = resp.json()
            except ValueError:
                return {"text": resp.text}
            # Weave returns business/authorization failures as HTTP 200 with
            # {"status": False, "message": ...} (e.g. NOT_MEMBER, FORBIDDEN,
            # CIRCULAR_DEPENDENCY, cross-branch rejections). Surface those as
            # errors so a rejected action is never reported to the model as success.
            if isinstance(body, dict) and body.get("status") is False:
                return {"error": "business", "detail": body.get("message", body)}
            return body

        try:
            detail = resp.json()
        except ValueError:
            detail = resp.text
        # 401 = the token itself is invalid/expired/revoked — flag it as "auth" so the
        # model/orchestrator can stop instead of hammering every tool with a dead token.
        # 403 (forbidden THIS resource) keeps its numeric code: the token is still fine.
        if resp.status_code == 401:
            return {"error": "auth", "detail": detail}
        return {"error": resp.status_code, "detail": detail}

    async def aclose(self) -> None:
        await self._http.aclose()
