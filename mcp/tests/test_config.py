from weave_mcp.config import get_settings


def test_get_settings_reads_env_and_strips_trailing_slash(monkeypatch):
    monkeypatch.setenv("WEAVE_BASE_URL", "http://example.com/")
    monkeypatch.setenv("WEAVE_SVC_EMAIL", "bot@x.com")
    monkeypatch.setenv("WEAVE_SVC_PASSWORD", "secret")
    s = get_settings()
    assert s.base_url == "http://example.com"  # trailing slash removed
    assert s.email == "bot@x.com"
    assert s.password == "secret"


def test_get_settings_defaults_base_url(monkeypatch):
    monkeypatch.delenv("WEAVE_BASE_URL", raising=False)
    monkeypatch.setenv("WEAVE_SVC_EMAIL", "bot@x.com")
    monkeypatch.setenv("WEAVE_SVC_PASSWORD", "secret")
    s = get_settings()
    assert s.base_url == "http://localhost:8000"
