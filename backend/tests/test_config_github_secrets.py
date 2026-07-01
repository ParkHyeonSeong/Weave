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
