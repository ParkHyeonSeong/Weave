import httpx

from .config import Settings, get_settings


class WeaveAuthError(Exception):
    """Raised when logging in to Weave with the service-account credentials fails."""


class WeaveClient:
    """Authenticated HTTP client for Weave's REST API.

    Holds one httpx.AsyncClient with a cookie jar. Logs in lazily: on any 401 it
    re-logs-in once (refreshing the weave_token cookie) and retries the request.
    """

    def __init__(self, settings: Settings | None = None):
        self._settings = settings or get_settings()
        self._http = httpx.AsyncClient(base_url=self._settings.base_url, timeout=30.0)

    async def _login(self) -> None:
        resp = await self._http.post(
            "/api/auth/login",
            json={"email": self._settings.email, "password": self._settings.password},
        )
        # Weave returns HTTP 200 even for bad credentials / inactive accounts,
        # signalling failure with a JSON body of {"status": false, "message": ...}.
        # A real session (the weave_token cookie) is granted only when status is true,
        # so the status code alone is not a reliable success check.
        if resp.status_code != 200:
            raise WeaveAuthError(f"Weave login failed (HTTP {resp.status_code}): {resp.text}")
        try:
            body = resp.json()
        except ValueError:
            body = {}
        if not body.get("status"):
            detail = body.get("message") or resp.text or "unknown error"
            raise WeaveAuthError(f"Weave login failed: {detail}")

    async def call(self, method: str, path: str, **kwargs) -> httpx.Response:
        resp = await self._http.request(method, path, **kwargs)
        if resp.status_code == 401:
            # Re-login once and retry. A still-401 response is returned as-is
            # (no loop); _login() raises WeaveAuthError if the login itself fails.
            await self._login()
            resp = await self._http.request(method, path, **kwargs)
        return resp

    async def call_json(self, method: str, path: str, **kwargs):
        """Call the API and return a JSON-friendly result.

        On success returns the parsed body (dict or list). On any failure returns a
        dict with an "error" key so tools never raise into the MCP layer.
        """
        try:
            resp = await self.call(method, path, **kwargs)
        except WeaveAuthError as exc:
            return {"error": "auth", "detail": str(exc)}
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
