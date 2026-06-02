import pytest
from pydantic import ValidationError

from routers.schema.pat import CreateToken


def test_create_token_minimal():
    m = CreateToken(name="MCP server")
    assert m.name == "MCP server"
    assert m.expires_in_days is None


def test_create_token_with_expiry():
    m = CreateToken(name="ci", expires_in_days=90)
    assert m.expires_in_days == 90


def test_create_token_rejects_blank_name():
    with pytest.raises(ValidationError):
        CreateToken(name="   ")


def test_create_token_rejects_nonpositive_expiry():
    with pytest.raises(ValidationError):
        CreateToken(name="x", expires_in_days=0)
