import hashlib

from library import crypto


def test_hash_token_is_deterministic():
    assert crypto.hash_token("wv_abc") == crypto.hash_token("wv_abc")


def test_hash_token_differs_per_input():
    assert crypto.hash_token("wv_abc") != crypto.hash_token("wv_xyz")


def test_hash_token_is_hex_sha256_length():
    assert len(crypto.hash_token("wv_abc")) == 64
    int(crypto.hash_token("wv_abc"), 16)  # valid hex


def test_hash_token_uses_pepper_when_key_set(monkeypatch):
    monkeypatch.setattr(crypto, "ENCRYPT_KEY", "some-pepper")
    plain = hashlib.sha256(b"wv_abc").hexdigest()
    assert crypto.hash_token("wv_abc") != plain


def test_hash_token_falls_back_to_sha256_without_key(monkeypatch):
    monkeypatch.setattr(crypto, "ENCRYPT_KEY", "")
    plain = hashlib.sha256(b"wv_abc").hexdigest()
    assert crypto.hash_token("wv_abc") == plain
