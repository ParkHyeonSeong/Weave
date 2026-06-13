import asyncio
import logging
import os
import re
import time
import uuid

from fastapi import Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from config import DEBUG

logger = logging.getLogger("weave.jira_migrate")

from core.model import branch_member as member_model
from core.model import branch as branch_model

# 업로드 임시 디렉토리
TEMP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'uploads', 'temp')
os.makedirs(TEMP_DIR, exist_ok=True)

# 임시 CSV 보존 한도(초, SEC-24). preview 후 execute가 호출되지 않으면 임시 파일이 고아로
# 남아 디스크를 잠식한다. lifespan 청소 작업이 이 한도를 넘은 파일을 주기적으로 지운다.
TEMP_FILE_TTL_SECONDS = int(os.getenv("JIRA_TEMP_TTL_SECONDS", str(24 * 3600)))


def cleanup_temp_files() -> int:
    """TTL을 넘긴 임시 CSV를 정리하고 삭제 개수를 반환한다(SEC-24). 호출 실패는 무시한다."""
    removed = 0
    now = time.time()
    try:
        names = os.listdir(TEMP_DIR)
    except OSError:
        return 0
    for name in names:
        path = os.path.join(TEMP_DIR, name)
        try:
            if os.path.isfile(path) and (now - os.path.getmtime(path)) > TEMP_FILE_TTL_SECONDS:
                os.remove(path)
                removed += 1
        except OSError:
            pass
    return removed


async def preview(branch_id: int, file: UploadFile, request: Request, db: AsyncSession):
    """CSV 업로드 → 프리뷰 데이터 반환"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    # 파일 검증
    if not file.filename or not file.filename.lower().endswith('.csv'):
        return {'status': False, 'message': 'CSV_FILE_REQUIRED'}

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:  # 10MB 제한
        return {'status': False, 'message': 'FILE_TOO_LARGE'}

    # 임시 파일 저장
    migration_id = uuid.uuid4().hex[:16]
    temp_path = os.path.join(TEMP_DIR, f'{migration_id}.csv')
    with open(temp_path, 'wb') as f:
        f.write(content)

    # CSV 파싱 (동기 코드를 스레드에서 실행)
    try:
        from scripts.migrate_jira_csv import CsvMigrator
        preview_data = await asyncio.to_thread(CsvMigrator.preview, temp_path)
    except Exception as e:
        # 파싱 실패 시 임시 파일 삭제
        if os.path.exists(temp_path):
            os.remove(temp_path)
        logger.error("CSV parse error: %s", e, exc_info=DEBUG)
        return {'status': False, 'message': 'CSV_PARSE_ERROR'}

    return {
        'status': True,
        'migration_id': migration_id,
        'assignees': preview_data['assignees'],
        'stats': preview_data['stats'],
    }


async def execute(branch_id: int, body, request: Request, db: AsyncSession):
    """마이그레이션 실행"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return {'status': False, 'message': 'ADMIN_ONLY'}

    # migration_id 검증 (경로 순회 방지)
    if not re.match(r'^[0-9a-f]{16}$', body.migration_id):
        return {'status': False, 'message': 'INVALID_MIGRATION_ID'}

    # 임시 파일 확인
    temp_path = os.path.join(TEMP_DIR, f'{body.migration_id}.csv')
    if not os.path.exists(temp_path):
        return {'status': False, 'message': 'MIGRATION_EXPIRED'}

    # 브랜치 정보 조회
    branch = await branch_model.find_by_id(branch_id, db)
    if not branch:
        return {'status': False, 'message': 'BRANCH_NOT_FOUND'}

    # CsvMigrator 실행 (동기 코드를 스레드에서 실행)
    try:
        from scripts.migrate_jira_csv import CsvMigrator
        from config import DATABASE_URL_SYNC

        def run_migration():
            migrator = CsvMigrator(
                csv_path=temp_path,
                branch_key=branch['key'],
                fallback_user_id=user_id,
                dry_run=False,
                db_url=DATABASE_URL_SYNC,
                user_mapping=body.user_mapping,
            )
            migrator.run()
            return migrator.stats

        stats = await asyncio.to_thread(run_migration)
    except Exception as e:
        logger.error("Migration failed: %s", e, exc_info=DEBUG)
        return {'status': False, 'message': 'MIGRATION_FAILED'}
    finally:
        # 임시 파일 삭제
        if os.path.exists(temp_path):
            os.remove(temp_path)

    return {
        'status': True,
        'stats': stats,
    }
