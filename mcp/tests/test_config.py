from weave_mcp.config import get_settings


def test_get_settings_reads_env_and_strips_trailing_slash(monkeypatch):
    monkeypatch.setenv("WEAVE_BASE_URL", "http://example.com/")
    monkeypatch.setenv("WEAVE_API_TOKEN", "wv_secret")
    s = get_settings()
    assert s.base_url == "http://example.com"  # trailing slash removed
    assert s.token == "wv_secret"


def test_get_settings_defaults(monkeypatch):
    monkeypatch.delenv("WEAVE_BASE_URL", raising=False)
    monkeypatch.delenv("WEAVE_API_TOKEN", raising=False)
    s = get_settings()
    assert s.base_url == "http://localhost:8000"
    assert s.token == ""
