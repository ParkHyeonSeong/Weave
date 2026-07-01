"""SLICE 1 — library/github_app.py tests.

Covers webhook signature verification (HMAC-SHA256 / compare_digest), App JWT
(RS256), and installation-token minting/caching. Later tasks append to this file.
"""
import base64
import hashlib
import hmac
import json
import time

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

import config

from library import github_app


def _sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


# ── Task 2: verify_signature ────────────────────────────────────────────
def test_verify_signature_accepts_valid():
    secret = "whsec_test_123"
    body = b'{"action":"opened","number":7}'
    assert github_app.verify_signature(secret, body, _sign(secret, body)) is True

def test_verify_signature_uses_raw_bytes_exactly():
    # Re-serialized JSON (added spaces) must NOT verify — signature is over the raw bytes.
    secret = "whsec_test_123"
    raw = b'{"action":"opened","number":7}'
    reserialized = b'{"action": "opened", "number": 7}'
    sig = _sign(secret, raw)
    assert github_app.verify_signature(secret, reserialized, sig) is False

def test_verify_signature_rejects_tampered_body():
    secret = "whsec_test_123"
    body = b'{"action":"opened"}'
    sig = _sign(secret, body)
    assert github_app.verify_signature(secret, b'{"action":"closed"}', sig) is False

def test_verify_signature_rejects_wrong_secret():
    body = b'{"x":1}'
    assert github_app.verify_signature("right", body, _sign("wrong", body)) is False

def test_verify_signature_rejects_missing_header():
    assert github_app.verify_signature("s", b"body", "") is False
    assert github_app.verify_signature("s", b"body", None) is False

def test_verify_signature_rejects_non_sha256_scheme():
    # GitHub's legacy SHA-1 header (sha1=...) must be rejected, not silently accepted.
    body = b"body"
    sha1_hex = hmac.new(b"s", body, hashlib.sha1).hexdigest()
    assert github_app.verify_signature("s", body, "sha1=" + sha1_hex) is False

def test_verify_signature_rejects_empty_secret():
    # No configured secret => fail closed (never accept).
    body = b"body"
    assert github_app.verify_signature("", body, _sign("", body)) is False


# ── Task 3: app_jwt (RS256) ─────────────────────────────────────────────
@pytest.fixture
def rsa_keypair():
    """Generate a throwaway RSA keypair (cryptography — newly pinned by this feature)."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private_pem, public_pem


def test_app_jwt_is_rs256_and_decodable_with_public_key(monkeypatch, rsa_keypair):
    private_pem, public_pem = rsa_keypair
    monkeypatch.setattr(github_app.config, "GITHUB_APP_ID", "424242")
    monkeypatch.setattr(github_app.config, "GITHUB_APP_PRIVATE_KEY", private_pem)

    token = github_app.app_jwt()
    header = jwt.get_unverified_header(token)
    assert header["alg"] == "RS256"

    decoded = jwt.decode(token, public_pem, algorithms=["RS256"])
    assert decoded["iss"] == "424242"

def test_app_jwt_claims_have_backdated_iat_and_bounded_exp(monkeypatch, rsa_keypair):
    private_pem, _ = rsa_keypair
    monkeypatch.setattr(github_app.config, "GITHUB_APP_ID", "1")
    monkeypatch.setattr(github_app.config, "GITHUB_APP_PRIVATE_KEY", private_pem)

    before = int(time.time())
    token = github_app.app_jwt()
    # Decode without verifying exp/iat to inspect raw claims.
    claims = jwt.decode(token, options={"verify_signature": False})
    # iat backdated ~60s to absorb clock skew (GitHub rejects future-iat).
    assert claims["iat"] <= before - 30
    # exp must be within GitHub's 10-minute hard cap.
    assert claims["exp"] - claims["iat"] <= 600
    assert claims["exp"] > before

def test_app_jwt_raises_when_private_key_unset(monkeypatch):
    monkeypatch.setattr(github_app.config, "GITHUB_APP_ID", "1")
    monkeypatch.setattr(github_app.config, "GITHUB_APP_PRIVATE_KEY", "")
    with pytest.raises(RuntimeError, match="GITHUB_APP_PRIVATE_KEY"):
        github_app.app_jwt()


# ── Task 4: installation_token (httpx + cache) ──────────────────────────
from datetime import datetime, timedelta, timezone


def _iso_in(seconds: int) -> str:
    # GitHub returns expires_at like "2026-06-26T12:00:00Z".
    dt = datetime.now(timezone.utc) + timedelta(seconds=seconds)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class _CountingTransport(httpx.MockTransport):
    """MockTransport that counts POSTs and returns a configurable token + expires_at."""
    def __init__(self, token="ghs_aaa", expires_in=3600):
        self.calls = []
        self._token = token
        self._expires_in = expires_in

        def handler(request: httpx.Request) -> httpx.Response:
            self.calls.append(str(request.url))
            return httpx.Response(
                201,
                json={"token": self._token, "expires_at": _iso_in(self._expires_in)},
            )

        super().__init__(handler)


@pytest.fixture(autouse=True)
def _clear_token_cache():
    # github_app keeps a module-level cache — isolate every test.
    github_app._token_cache.clear()
    yield
    github_app._token_cache.clear()


@pytest.fixture
def app_jwt_stub(monkeypatch):
    # installation_token signs an App JWT internally; stub it so these tests need no RSA key.
    monkeypatch.setattr(github_app, "app_jwt", lambda: "stub.jwt.token")


async def test_installation_token_posts_and_returns_token(monkeypatch, app_jwt_stub):
    transport = _CountingTransport(token="ghs_first")
    monkeypatch.setattr(
        github_app, "_github_client",
        lambda: httpx.AsyncClient(transport=transport, base_url=github_app.GITHUB_API_BASE),
    )
    tok = await github_app.installation_token(99)
    assert tok == "ghs_first"
    assert len(transport.calls) == 1
    assert transport.calls[0].endswith("/app/installations/99/access_tokens")


async def test_installation_token_caches_within_expiry(monkeypatch, app_jwt_stub):
    transport = _CountingTransport(token="ghs_cached", expires_in=3600)
    monkeypatch.setattr(
        github_app, "_github_client",
        lambda: httpx.AsyncClient(transport=transport, base_url=github_app.GITHUB_API_BASE),
    )
    first = await github_app.installation_token(7)
    second = await github_app.installation_token(7)
    assert first == second == "ghs_cached"
    # Second call must be a cache hit — exactly one POST.
    assert len(transport.calls) == 1


async def test_installation_token_refreshes_after_expiry(monkeypatch, app_jwt_stub):
    # expires_in tiny so it is already inside the 60s refresh skew => treated as expired.
    transport = _CountingTransport(token="ghs_x", expires_in=10)
    monkeypatch.setattr(
        github_app, "_github_client",
        lambda: httpx.AsyncClient(transport=transport, base_url=github_app.GITHUB_API_BASE),
    )
    await github_app.installation_token(5)
    await github_app.installation_token(5)
    # expires_at within skew window => not cached => two POSTs.
    assert len(transport.calls) == 2


async def test_installation_token_isolates_per_installation(monkeypatch, app_jwt_stub):
    transport = _CountingTransport(token="ghs_iso", expires_in=3600)
    monkeypatch.setattr(
        github_app, "_github_client",
        lambda: httpx.AsyncClient(transport=transport, base_url=github_app.GITHUB_API_BASE),
    )
    await github_app.installation_token(1)
    await github_app.installation_token(2)
    # Different installation ids never share a cache entry.
    assert len(transport.calls) == 2
