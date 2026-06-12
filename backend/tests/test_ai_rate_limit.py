"""SEC-11/SEC-26: AI 채팅 입력 길이 상한 + 계정 기반 레이트리밋 key.

- AIChatMessage.content 길이 상한(대량 본문으로 LLM 비용/메모리 고갈 방지).
- 비용 엔드포인트는 IP가 아니라 계정(user_id)별로 제한 → 공유 NAT 정상 사용자 보호.
"""
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from routers.schema.ai import AIChatMessage, AI_MESSAGE_MAX_LENGTH
from library.rate_limiter import user_or_ip_key


# ── SEC-26: content 길이 상한 ──────────────────────────────────────────────

def test_content_at_max_length_ok():
    m = AIChatMessage(content='a' * AI_MESSAGE_MAX_LENGTH)
    assert len(m.content) == AI_MESSAGE_MAX_LENGTH


def test_content_over_max_length_rejected():
    with pytest.raises(ValidationError):
        AIChatMessage(content='a' * (AI_MESSAGE_MAX_LENGTH + 1))


def test_blank_content_rejected():
    with pytest.raises(ValidationError):
        AIChatMessage(content='   ')


# ── SEC-11: 레이트리밋 key는 계정 우선, 미인증은 IP ────────────────────────

def test_key_uses_user_id_when_authenticated():
    req = SimpleNamespace(
        state=SimpleNamespace(payload={'user_id': 42}),
        client=SimpleNamespace(host='203.0.113.1'),
        headers={},
    )
    assert user_or_ip_key(req) == 'user:42'


def test_key_falls_back_to_ip_when_anonymous():
    req = SimpleNamespace(
        state=SimpleNamespace(payload={}),
        client=SimpleNamespace(host='203.0.113.1'),
        headers={},
    )
    # 미인증 + 신뢰하지 않는 피어 → 실제 피어 IP
    assert user_or_ip_key(req) == '203.0.113.1'
