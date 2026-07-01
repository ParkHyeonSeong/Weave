"""GitHub 웹훅 멱등 staging + 단일승자 claim 저장소.

수신부는 검증 후 INSERT(status='pending')만 하고 202를 즉시 반환한다. 같은
delivery_id 재전송은 UNIQUE 충돌로 IntegrityError → None 반환(no-op). 처리는
claim_one()이 단일승자로 한 행을 잡아(FOR UPDATE SKIP LOCKED) processing으로 옮긴
뒤 dispatch한다. 죽은 락(처리 중 5분 초과)은 회수, attempts 캡으로 poison 차단.

레포 최초 FOR UPDATE SKIP LOCKED 도입(개념 선례는 refresh_token.consume_by_hash의
"DELETE=뮤텍스" 관용구). DELETE 대신 조건부 UPDATE+RETURNING이 동시획득을 차단한다.
"""
import json

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


async def insert(delivery_id: str, event_type: str, payload: dict, db: AsyncSession) -> dict | None:
    """staging 행 1개 INSERT(status='pending'). 같은 delivery_id가 이미 있으면
    UNIQUE 충돌(GitHub 재전송) → None 반환(멱등 no-op, 1 row만 유지).

    UNIQUE 위반은 트랜잭션을 abort시키므로 savepoint(begin_nested) 안에서 실행해
    충돌 시 그 savepoint만 롤백하고 바깥 트랜잭션은 살린다."""
    try:
        async with db.begin_nested():
            result = await db.execute(text("""
                INSERT INTO github_webhook_event (delivery_id, event_type, payload)
                VALUES (:delivery_id, :event_type, CAST(:payload AS jsonb))
                RETURNING event_id, delivery_id, event_type, status, attempts, received_at
            """), {
                'delivery_id': delivery_id,
                'event_type': event_type,
                'payload': json.dumps(payload),
            })
            row = result.fetchone()
        return dict(row._mapping)
    except IntegrityError:
        return None


async def claim_one(db: AsyncSession, max_attempts: int = 5) -> dict | None:
    """미처리(pending/failed, attempts<max) 또는 죽은 락(processing>5분) 행 1개를
    단일승자로 잡아 processing으로 옮기고 반환. 동시 워커는 FOR UPDATE SKIP LOCKED로
    같은 행을 건너뛴다. 잡을 게 없으면 None."""
    result = await db.execute(text("""
        UPDATE github_webhook_event
        SET status='processing', locked_at=NOW(), attempts=attempts+1
        WHERE event_id = (
            SELECT event_id FROM github_webhook_event
            WHERE (status IN ('pending', 'failed') AND attempts < :max_attempts
                   AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
               OR (status = 'processing' AND attempts < :max_attempts
                   AND locked_at < NOW() - INTERVAL '5 minutes')
            ORDER BY received_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING event_id, delivery_id, event_type, payload, attempts
    """), {'max_attempts': max_attempts})
    row = result.fetchone()
    return dict(row._mapping) if row else None
