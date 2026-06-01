import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load mcp/.env explicitly (NOT the repo-root .env, which belongs to the backend).
# __file__ = mcp/weave_mcp/config.py -> parents[1] = mcp/
_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(_ENV_PATH)


@dataclass(frozen=True)
class Settings:
    base_url: str
    email: str
    password: str


def get_settings() -> Settings:
    return Settings(
        base_url=os.getenv("WEAVE_BASE_URL", "http://localhost:8000").rstrip("/"),
        email=os.getenv("WEAVE_SVC_EMAIL", ""),
        password=os.getenv("WEAVE_SVC_PASSWORD", ""),
    )
