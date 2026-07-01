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


# ---------------------------------------------------------------------------
# claim_one — 단일승자 lease (FOR UPDATE SKIP LOCKED)
# ---------------------------------------------------------------------------

async def test_claim_moves_pending_to_processing(db_session):
    inserted = await ghwe_model.insert("d-claim", "push", {"x": 1}, db_session)
    claimed = await ghwe_model.claim_one(db_session)
    assert claimed is not None
    assert claimed["event_id"] == inserted["event_id"]
    assert claimed["delivery_id"] == "d-claim"
    assert claimed["payload"] == {"x": 1}
    assert claimed["attempts"] == 1  # claim이 attempts 증가

    res = await db_session.execute(text(
        "SELECT status, locked_at FROM github_webhook_event WHERE event_id = :e"
    ), {"e": inserted["event_id"]})
    st = res.fetchone()
    assert st.status == "processing"
    assert st.locked_at is not None


async def test_second_claim_does_not_return_same_row(db_session):
    a = await ghwe_model.insert("d-a", "push", {"i": "a"}, db_session)
    b = await ghwe_model.insert("d-b", "push", {"i": "b"}, db_session)
    first = await ghwe_model.claim_one(db_session)
    second = await ghwe_model.claim_one(db_session)
    # 첫 claim이 잡은 행은 processing이라 두 번째는 다른 행(또는 없음)
    assert first["event_id"] != second["event_id"]
    assert {first["event_id"], second["event_id"]} == {a["event_id"], b["event_id"]}
    # 큐가 비면 None
    third = await ghwe_model.claim_one(db_session)
    assert third is None


async def test_claim_skips_recent_processing_lock(db_session):
    await ghwe_model.insert("d-lock", "push", {}, db_session)
    first = await ghwe_model.claim_one(db_session)
    assert first is not None
    # 방금 잡혀 processing(locked_at=NOW)인 행은 5분 미경과라 재획득 안 됨
    again = await ghwe_model.claim_one(db_session)
    assert again is None


async def test_claim_reclaims_stale_processing_lock(db_session):
    inserted = await ghwe_model.insert("d-stale", "push", {}, db_session)
    first = await ghwe_model.claim_one(db_session)
    assert first is not None
    # 죽은 락 시뮬레이션: locked_at을 6분 전으로 back-dating
    await db_session.execute(text("""
        UPDATE github_webhook_event
        SET locked_at = NOW() - INTERVAL '6 minutes'
        WHERE event_id = :e
    """), {"e": inserted["event_id"]})
    reclaimed = await ghwe_model.claim_one(db_session)
    assert reclaimed is not None
    assert reclaimed["event_id"] == inserted["event_id"]
    assert reclaimed["attempts"] == 2  # 재획득 시 attempts 또 증가


async def test_claim_respects_attempts_cap(db_session):
    inserted = await ghwe_model.insert("d-poison", "push", {}, db_session)
    # attempts를 cap(기본 5)까지 올리고 failed 상태로 둔다
    await db_session.execute(text("""
        UPDATE github_webhook_event
        SET status='failed', attempts=5
        WHERE event_id = :e
    """), {"e": inserted["event_id"]})
    claimed = await ghwe_model.claim_one(db_session, max_attempts=5)
    assert claimed is None  # attempts >= max → 재시도 제외(poison 방지)


async def test_claim_empty_queue_returns_none(db_session):
    assert await ghwe_model.claim_one(db_session) is None


# ---------------------------------------------------------------------------
# mark_done / mark_failed
# ---------------------------------------------------------------------------

async def test_mark_done(db_session):
    inserted = await ghwe_model.insert("d-done", "push", {}, db_session)
    await ghwe_model.claim_one(db_session)
    await ghwe_model.mark_done(inserted["event_id"], db_session)
    res = await db_session.execute(text(
        "SELECT status, processed_at FROM github_webhook_event WHERE event_id = :e"
    ), {"e": inserted["event_id"]})
    row = res.fetchone()
    assert row.status == "done"
    assert row.processed_at is not None


async def test_mark_failed_records_error(db_session):
    inserted = await ghwe_model.insert("d-fail", "push", {}, db_session)
    await ghwe_model.claim_one(db_session)
    await ghwe_model.mark_failed(inserted["event_id"], "boom", db_session)
    res = await db_session.execute(text(
        "SELECT status, last_error, attempts FROM github_webhook_event WHERE event_id = :e"
    ), {"e": inserted["event_id"]})
    row = res.fetchone()
    assert row.status == "failed"
    assert row.last_error == "boom"
    assert row.attempts == 1  # claim에서 1로 올랐고 mark_failed는 안 건드림
