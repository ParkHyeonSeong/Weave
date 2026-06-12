"""SEC-05: LLM API 오류 로깅이 민감할 수 있는 응답 본문을 기본 로그에 남기지 않는지.

응답 본문은 사용자 요청 컨텍스트를 echo back할 수 있으므로, 기본(비 DEBUG) 로그에는
상태 코드와 바이트 크기만 남고 본문은 남지 않아야 한다. 본문은 DEBUG에서만 진단용으로 남는다.
"""
import logging

from core.controller import ai as ai_controller

SENSITIVE = b'{"error":{"message":"echoed SENSITIVE-USER-CONTENT here"}}'


def test_llm_api_error_logs_status_and_size_not_body(caplog):
    with caplog.at_level(logging.INFO, logger="weave.ai"):
        ai_controller._log_llm_api_error("Anthropic", 401, SENSITIVE)
    text = "\n".join(r.getMessage() for r in caplog.records)
    # ERROR 로그가 실제로 발생했는지 먼저 보장 — 아무것도 안 남기는 회귀에서 본문-부재 단언이 거짓통과하는 것 방지
    assert any(r.levelno == logging.ERROR for r in caplog.records)
    assert "Anthropic" in text
    assert "401" in text
    assert str(len(SENSITIVE)) in text            # 바이트 크기는 남긴다
    assert "SENSITIVE-USER-CONTENT" not in text   # 본문은 기본 로그에 남기지 않는다


def test_llm_api_error_body_only_at_debug(caplog):
    with caplog.at_level(logging.DEBUG, logger="weave.ai"):
        ai_controller._log_llm_api_error("OpenAI", 400, SENSITIVE)
    text = "\n".join(r.getMessage() for r in caplog.records)
    # DEBUG 레벨(개발/스테이징)에서만 본문이 진단용으로 남는다
    assert "SENSITIVE-USER-CONTENT" in text
