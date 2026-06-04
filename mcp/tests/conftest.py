from unittest.mock import AsyncMock

import pytest

from weave_mcp import _app


@pytest.fixture
def fake_client(monkeypatch):
    fake = AsyncMock()
    monkeypatch.setattr(_app, "_client", fake)
    return fake
