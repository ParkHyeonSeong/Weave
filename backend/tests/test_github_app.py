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
