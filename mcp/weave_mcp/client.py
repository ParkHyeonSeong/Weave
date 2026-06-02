import httpx

from .config import Settings, get_settings


class WeaveClient:
    """Authenticated HTTP client for Weave's REST API using a Personal Access Token.

    The token is sent as an ``Authorization: Bearer`` header on every request. PATs are
    long-lived, so there is no login, cookie, session, or refresh logic — an invalid or
    revoked token simply yields a 401, surfaced as an error result by ``call_json``.
    """

    def __init__(self, settings: Settings | None = None):
        self._settings = settings or get_settings()
        headers = {}
        if self._settings.token:
            headers["Authorization"] = f"Bearer {self._settings.token}"
        self._http = httpx.AsyncClient(
            base_url=self._settings.base_url, timeout=30.0, headers=headers
        )

    async def call(self, method: str, path: str, **kwargs) -> httpx.Response:
        return await self._http.request(method, path, **kwargs)

    async def call_json(self, method: str, path: str, **kwargs):
        """Call the API and return a JSON-friendly result.

        On success returns the parsed body (dict or list). On any failure returns a
        dict with an "error" key so tools never raise into the MCP layer.
        """
        if not self._settings.token:
            return {"error": "auth", "detail": "WEAVE_API_TOKEN is not set"}
        try:
            resp = await self.call(method, path, **kwargs)
        except httpx.HTTPError as exc:
            return {"error": "network", "detail": str(exc)}

        if resp.is_success:
            try:
                return resp.json()
            except ValueError:
                return {"text": resp.text}

        try:
            detail = resp.json()
        except ValueError:
            detail = resp.text
        return {"error": resp.status_code, "detail": detail}

    async def aclose(self) -> None:
        await self._http.aclose()
