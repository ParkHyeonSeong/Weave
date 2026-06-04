from fastmcp import FastMCP

from .client import WeaveClient

mcp = FastMCP("weave")

_client: WeaveClient | None = None


def get_client() -> WeaveClient:
    global _client
    if _client is None:
        _client = WeaveClient()
    return _client
