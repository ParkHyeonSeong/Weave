"""CFG-03: 프로덕션(DEBUG=false)에서 약한 기본 DATABASE_URL/미설정을 거부한다.

운영자가 DATABASE_URL/DB 비밀번호를 깜빡해도 백엔드가 'weave:weave' 기본값으로 조용히
뜨지 않도록, config import 시점에 RuntimeError로 시작을 막는지 검증한다(JWT/ENCRYPT와 동일).
import 시점 가드라 서브프로세스로 환경변수를 바꿔가며 확인한다.
"""
import os
import subprocess
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DEFAULT_DB = "postgresql+asyncpg://weave:weave@db:5432/weave"
_STRONG_DB = "postgresql+asyncpg://weave:s3cr3t-strong-pw@db:5432/weave"
# 프로덕션에서 JWT/ENCRYPT 가드를 통과시켜 DATABASE_URL 가드만 격리
_PROD = {"DEBUG": "false", "JWT_SECRET_KEY": "x" * 64, "ENCRYPT_KEY": "y" * 64}


def _import_config(overrides, remove=()):
    env = dict(os.environ)
    env.update(overrides)
    for k in remove:
        env.pop(k, None)
    return subprocess.run(
        [sys.executable, "-c", "import config"],
        cwd=BACKEND_DIR, env=env, capture_output=True, text=True,
    )


def test_prod_rejects_default_db_url():
    r = _import_config({**_PROD, "DATABASE_URL": _DEFAULT_DB})
    assert r.returncode != 0
    assert "DATABASE_URL" in r.stderr


def test_prod_rejects_unset_db_url():
    r = _import_config(_PROD, remove=["DATABASE_URL"])
    assert r.returncode != 0
    assert "DATABASE_URL" in r.stderr


def test_prod_rejects_placeholder_db_url():
    # 예제 파일을 복사만 하고 비번을 안 바꾼 경우(CHANGE_ME_*)도 거부
    placeholder_db = "postgresql+asyncpg://weave:CHANGE_ME_TO_STRONG_RANDOM_PASSWORD@db:5432/weave"
    r = _import_config({**_PROD, "DATABASE_URL": placeholder_db})
    assert r.returncode != 0
    assert "DATABASE_URL" in r.stderr


def test_prod_rejects_placeholder_secret():
    # JWT_SECRET_KEY가 미치환 플레이스홀더면 거부(ENCRYPT_KEY도 동일 패턴)
    r = _import_config({"DEBUG": "false", "JWT_SECRET_KEY": "CHANGE_ME_TO_RANDOM_HEX_64",
                        "ENCRYPT_KEY": "y" * 64, "DATABASE_URL": _STRONG_DB})
    assert r.returncode != 0
    assert "JWT_SECRET_KEY" in r.stderr


def test_prod_accepts_strong_db_url():
    r = _import_config({**_PROD, "DATABASE_URL": _STRONG_DB})
    assert r.returncode == 0, r.stderr


def test_dev_allows_default_db_url():
    # dev(DEBUG=true)는 기본값 허용 — 개발 편의. DEBUG=true 경로는 JWT/ENCRYPT를
    # 자동 생성/폴백하므로 별도 설정 없이도 import가 성공한다(가드는 prod 전용).
    r = _import_config({"DEBUG": "true", "DATABASE_URL": _DEFAULT_DB})
    assert r.returncode == 0, r.stderr
