"""GitHub webhook 처리 오케스트레이션 — 자동 경로(전이 + 링크 + 브로드캐스트).

자동 경로는 외부 GitHub API 호출이 없다(payload에 제목·본문·state·head.ref·html_url
이 포함). 따라서 dispatch는 순수 DB 작업 + 부수효과(transition 내부의 활동/알림)뿐이다.
WS 브로드캐스트는 트랜잭션 커밋 후에만(process_webhook_event) 발사한다.
"""
import logging

from sqlalchemy import text

from library import github_parser
from library.ws_manager import manager
from core.model import branch as branch_model
from core.model import task as task_model
from core.model import github_integration as integration_model
from core.model import task_github_ref as ref_model
from core.model import github_webhook_event as event_model
from core.service import task_transition
import db_engine as db_engine

logger = logging.getLogger("weave")

# PR action -> (transition gate, ref state). gate None = 링크만, 전이 없음.
_ACTION_GATE = {
    'opened': ('open', 'open'),
    'reopened': ('open', 'open'),
    'ready_for_review': ('open', 'open'),
}


def _gate_and_state(action: str, merged: bool):
    """PR action(+merged)을 transition gate와 ref state로 매핑."""
    if action == 'closed':
        if merged:
            return ('merge', 'merged')
        return ('close', 'closed')
    return _ACTION_GATE.get(action, (None, 'open'))


async def _resolve_actor_id(db) -> int | None:
    """자동 전이의 actor — 'GitHub' 시스템 봇 user_id."""
    result = await db.execute(text(
        'SELECT user_id FROM "user" WHERE is_system = TRUE ORDER BY user_id LIMIT 1'))
    row = result.fetchone()
    return row[0] if row else None


async def dispatch_event(event_type: str, payload: dict, db) -> None:
    """단일 webhook 이벤트를 처리한다(이미 claim된 row의 payload).

    pull_request 외 이벤트는 v1에서 무시(push 커밋 링크는 v2 보류).
    매칭 0건/연결 안 된 repo/없는 태스크는 조용히 skip(에러 아님).
    """
    if event_type != 'pull_request':
        return

    pr = payload.get('pull_request') or {}
    action = payload.get('action') or ''
    repo = (payload.get('repository') or {}).get('full_name')
    if not repo:
        return

    number = pr.get('number')
    title = pr.get('title') or ''
    body = pr.get('body') or ''
    head_ref = ((pr.get('head') or {}).get('ref')) or ''
    html_url = pr.get('html_url') or ''
    merged = bool(pr.get('merged'))
    if number is None or not html_url:
        return

    gate, ref_state = _gate_and_state(action, merged)
    refs = github_parser.extract_refs(f"{head_ref} {title} {body}")
    if not refs:
        return

    actor_id = await _resolve_actor_id(db)

    for key, display_number in refs:
        branch_row = await branch_model.find_by_key_row(key, db)
        if not branch_row:
            continue
        branch_id = branch_row['branch_id']

        # 연결되고 enabled된 repo만 처리(오탐 축소).
        if not await integration_model.find_enabled(branch_id, repo, db):
            continue

        task_row = await task_model.find_by_display(branch_id, display_number, db)
        if not task_row:
            continue
        task_id = task_row['task_id']

        ref = await ref_model.upsert_pr(
            task_id=task_id, repo_full_name=repo, ref_number=number,
            sha=None, title=title, state=ref_state, html_url=html_url,
            linked_by=None, db=db,
        )

        if gate is not None:
            await task_transition.transition(
                task_id, branch_id, gate, actor_id, db, this_ref_id=ref['ref_id'],
            )


async def process_webhook_event(event: dict, db) -> None:
    """claim된 단일 이벤트를 dispatch한다. mark_done/mark_failed는 호출자 소유.

    WS 브로드캐스트는 여기서 모으지 않고 dispatch 후 별도 commit 경계 뒤에
    drain_webhook_events가 발사한다(커밋 후 발사 규칙).
    """
    await dispatch_event(event['event_type'], event['payload'], db)


async def drain_webhook_events() -> int:
    """pending/failed/죽은락 이벤트를 단일승자 claim으로 드레인 처리한다.

    각 이벤트를 자체 transactional_session에서 처리한다(요청 세션 재사용 금지).
    처리 성공 시 mark_done + 커밋 후 broadcast_to_branch 발사. 실패 시 mark_failed.
    반환: 처리(성공/실패 포함)한 이벤트 수.
    """
    processed = 0
    while True:
        # 1) claim — 자체 트랜잭션(claim은 즉시 커밋되어야 다른 워커가 중복 안 잡음)
        async with db_engine.transactional_session() as claim_db:
            event = await event_model.claim_one(claim_db)
        if not event:
            break

        processed += 1
        broadcasts: list[tuple[int, dict]] = []
        try:
            async with db_engine.transactional_session() as work_db:
                await process_webhook_event(event, work_db)
                # 전이/링크 대상 브랜치 수집(커밋 후 발사)
                refs = github_parser.extract_refs(
                    _collectable_text(event['payload']))
                for key, _num in refs:
                    brow = await branch_model.find_by_key_row(key, work_db)
                    if brow:
                        broadcasts.append((brow['branch_id'], {
                            'type': 'task_updated',
                            'branch_id': brow['branch_id'],
                            'source': 'github',
                        }))
                await event_model.mark_done(event['event_id'], work_db)
        except Exception as exc:  # noqa: BLE001 — poison 격리 위해 광범위 catch
            logger.warning("github webhook event %s failed: %s",
                           event.get('event_id'), exc, exc_info=False)
            async with db_engine.transactional_session() as fail_db:
                await event_model.mark_failed(event['event_id'], str(exc), fail_db)
            continue

        # 2) 커밋 후 브로드캐스트(트랜잭션 밖, best-effort)
        async with db_engine.transactional_session() as bc_db:
            for branch_id, data in broadcasts:
                await manager.broadcast_to_branch(branch_id, data, bc_db)

    return processed


def _collectable_text(payload: dict) -> str:
    pr = payload.get('pull_request') or {}
    head_ref = ((pr.get('head') or {}).get('ref')) or ''
    return f"{head_ref} {pr.get('title') or ''} {pr.get('body') or ''}"
