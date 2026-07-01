"""github_webhook_event 멱등 staging + 단일승자 claim 테스트.

Style: 모델 직접 호출, rollback-isolated db_session 픽스처. 동시성(SKIP LOCKED)
검증은 단일 트랜잭션 안에서 같은 행 재획득 불가/죽은 락 재획득을 raw UPDATE로
타임스탬프를 back-dating해 결정적으로 재현한다.
"""
from sqlalchemy import text

from core.model import github_webhook_event as ghwe_model


async def _count_rows(db, delivery_id):
    res = await db.execute(text(
        "SELECT COUNT(*) FROM github_webhook_event WHERE delivery_id = :d"
    ), {"d": delivery_id})
    return res.scalar_one()


# ---------------------------------------------------------------------------
# insert — 멱등(같은 delivery_id 재전송은 1 row, 2번째는 None)
# ---------------------------------------------------------------------------

async def test_insert_returns_row(db_session):
    row = await ghwe_model.insert("d-1", "pull_request", {"action": "opened"}, db_session)
    assert row is not None
    assert row["delivery_id"] == "d-1"
    assert row["event_type"] == "pull_request"
    assert row["status"] == "pending"
    assert row["attempts"] == 0


async def test_insert_duplicate_delivery_returns_none_one_row(db_session):
    first = await ghwe_model.insert("d-dup", "pull_request", {"n": 1}, db_session)
    assert first is not None
    second = await ghwe_model.insert("d-dup", "pull_request", {"n": 2}, db_session)
    assert second is None
    # 충돌 catch 후에도 바깥 트랜잭션은 살아있어 후속 쿼리가 동작한다
    assert await _count_rows(db_session, "d-dup") == 1
