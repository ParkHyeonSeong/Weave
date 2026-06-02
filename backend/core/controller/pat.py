import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from core.model import pat as pat_model
from library import crypto

TOKEN_BYTES = 32
PREFIX_LEN = 11  # "wv_" + 8 chars


def _generate_token() -> tuple[str, str, str]:
    raw = "wv_" + secrets.token_urlsafe(TOKEN_BYTES)
    return raw, crypto.hash_token(raw), raw[:PREFIX_LEN]


async def create_token(body, request, db: AsyncSession) -> dict:
    user_id = request.state.payload["user_id"]
    raw, token_hash, prefix = _generate_token()
    expires_at = None
    if body.expires_in_days is not None:
        expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)
    pat_id = await pat_model.create(user_id, body.name, token_hash, prefix, expires_at, db)
    return {
        "status": True,
        "token": raw,  # shown ONCE
        "pat": {"pat_id": pat_id, "name": body.name, "token_prefix": prefix,
                "expires_at": expires_at},
    }


async def list_tokens(request, db: AsyncSession) -> dict:
    user_id = request.state.payload["user_id"]
    tokens = await pat_model.list_for_user(user_id, db)
    return {"status": True, "tokens": tokens}


async def revoke_token(pat_id: int, request, db: AsyncSession) -> dict:
    user_id = request.state.payload["user_id"]
    ok = await pat_model.revoke(pat_id, user_id, db)
    if not ok:
        return {"status": False, "message": "TOKEN_NOT_FOUND"}
    return {"status": True}


async def authenticate_token(raw_token: str, db: AsyncSession) -> dict | None:
    """Resolve a raw Bearer token to an auth payload, or None. Called by the middleware."""
    row = await pat_model.find_active_by_hash(crypto.hash_token(raw_token), db)
    if not row:
        return None
    await pat_model.touch_last_used(row["pat_id"], db)
    return {"user_id": row["user_id"], "email": row["email"],
            "username": row["username"], "role": row["role"]}
