"""IssueTransition 스키마 단위 테스트 (Pydantic 레이어 — 컨트롤러 직접호출로는 422를 못 잡음)."""
import pytest
from pydantic import ValidationError

from routers.schema.task_issue import IssueTransition


def test_allows_none():
    assert IssueTransition().comment is None


def test_allows_valid_html():
    assert IssueTransition(comment="<p>hi</p>").comment == "<p>hi</p>"


def test_rejects_empty_html():
    with pytest.raises(ValidationError):
        IssueTransition(comment="<p></p>")


def test_rejects_too_long():
    with pytest.raises(ValidationError):
        IssueTransition(comment="a" * 10001)
