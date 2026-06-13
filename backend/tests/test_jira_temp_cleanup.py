"""SEC-24: Jira 마이그레이션 임시 CSV의 TTL 기반 정리.

preview만 하고 execute를 호출하지 않으면 임시 파일이 고아로 남는다. cleanup_temp_files가
TTL을 넘긴 파일만 지우고 신선한 파일은 보존하는지 확인한다.
"""
import os
import time

from core.controller import jira_migrate


def test_cleanup_removes_expired_keeps_fresh():
    d = jira_migrate.TEMP_DIR
    ttl = jira_migrate.TEMP_FILE_TTL_SECONDS
    old = os.path.join(d, 'pytest_old_sec24.csv')
    fresh = os.path.join(d, 'pytest_fresh_sec24.csv')
    with open(old, 'w') as f:
        f.write('x')
    with open(fresh, 'w') as f:
        f.write('x')
    past = time.time() - (ttl + 100)
    os.utime(old, (past, past))
    try:
        removed = jira_migrate.cleanup_temp_files()
        assert not os.path.exists(old), "TTL 초과 파일은 삭제돼야 함"
        assert os.path.exists(fresh), "신선한 파일은 보존돼야 함"
        assert removed >= 1
    finally:
        for p in (old, fresh):
            if os.path.exists(p):
                os.remove(p)


def test_cleanup_safe_on_empty_dir():
    # 디렉터리에 만료 파일이 없으면 0 반환, 예외 없음
    assert jira_migrate.cleanup_temp_files() >= 0
