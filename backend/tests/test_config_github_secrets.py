"""SLICE 0 foundation tests: cryptography dep + GITHUB_* config secrets.

Style: plain unit tests (no db_session needed) — assert the dependency is
declared in pyproject and importable, and that config exposes the new GitHub
secrets following the existing os.getenv + non-DEBUG placeholder-reject pattern.
"""
import tomllib
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def test_cryptography_is_declared_dependency():
    data = tomllib.loads((BACKEND_DIR / "pyproject.toml").read_text())
    deps = data["project"]["dependencies"]
    assert any(d.startswith("cryptography>=43") for d in deps), (
        "cryptography must be an explicit dependency (was only transitive via pywebpush)"
    )


def test_cryptography_importable():
    import cryptography.fernet  # noqa: F401


def test_config_exposes_github_secrets():
    import config
    assert hasattr(config, "GITHUB_APP_ID")
    assert hasattr(config, "GITHUB_APP_PRIVATE_KEY")
    assert hasattr(config, "GITHUB_WEBHOOK_SECRET")
    # defaults are empty strings (feature off until a branch admin connects a repo)
    assert isinstance(config.GITHUB_APP_ID, str)
    assert isinstance(config.GITHUB_APP_PRIVATE_KEY, str)
    assert isinstance(config.GITHUB_WEBHOOK_SECRET, str)


def test_prod_rejects_placeholder_webhook_secret(monkeypatch):
    """Non-DEBUG + a CHANGE_ME webhook secret must raise (copied-example footgun),
    mirroring JWT_SECRET_KEY / ENCRYPT_KEY placeholder rejection."""
    import importlib
    import config as config_module

    monkeypatch.setenv("DEBUG", "false")
    # the other hard-required prod secrets must be present so import reaches our check
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:strongpw@db:5432/weave")
    monkeypatch.setenv("JWT_SECRET_KEY", "a" * 64)
    monkeypatch.setenv("ENCRYPT_KEY", "b" * 64)
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", "CHANGE_ME_TO_WEBHOOK_SECRET")
    import pytest
    with pytest.raises(RuntimeError, match="GITHUB_WEBHOOK_SECRET"):
        importlib.reload(config_module)
    # restore the real (DEBUG) config for the rest of the session
    monkeypatch.undo()
    importlib.reload(config_module)


def test_config_decodes_github_private_key_from_base64_env(monkeypatch):
    """base64(PEM) env를 config가 디코드해 PEM 문자열로 노출하는지 실제 reload로 검증.
    config.py에 `import base64`가 빠지면 여기서 NameError로 잡힌다(운영 장애 예방)."""
    import base64
    import importlib
    import config as config_module

    pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----\n"
    monkeypatch.setenv("DEBUG", "true")  # prod 하드요구 시크릿 없이 reload가 우리 코드까지 도달
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", base64.b64encode(pem.encode()).decode())
    try:
        importlib.reload(config_module)
        assert config_module.GITHUB_APP_PRIVATE_KEY == pem       # 디코드된 PEM 문자열
    finally:
        monkeypatch.undo()
        importlib.reload(config_module)                          # 세션 나머지를 위해 원복
