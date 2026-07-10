"""JS 코덱(markdownCodec.js)과 Python 변환기(html_markdown.py)의 golden 패리티.

fixture는 S0(frontend 코덱)이 생성 — 부재 시 skip (S2 선출시 허용).
케이스 스키마: {name, markdown, html_tiptap, html_ingress|null, directions[]}.
"""
import json
import pathlib

import pytest

import config
from library.html_markdown import html_to_markdown, markdown_to_html

_FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "markdown_codec_cases.json"
if not _FIXTURE.exists():
    pytest.skip("markdown_codec_cases.json 미생성 — S0 선행 필요", allow_module_level=True)

CASES = json.loads(_FIXTURE.read_text())
# egress: html->md 또는 roundtrip 케이스 전부
EGRESS = [c for c in CASES if {"html->md", "roundtrip"} & set(c["directions"])]
# ingress: md->html/roundtrip 중 html_ingress(파이썬 기대 출력)가 명시된 케이스만
INGRESS = [c for c in CASES
           if {"md->html", "roundtrip"} & set(c["directions"]) and c.get("html_ingress")]


@pytest.fixture(autouse=True)
def _fixture_origin(monkeypatch):
    # fixture의 칩 링크는 절대 URL(https://weave.test) — JS 패리티(jsdom origin 고정)와 동일 기준
    monkeypatch.setattr(config, 'FRONTEND_URL', 'https://weave.test')


@pytest.mark.parametrize("case", EGRESS, ids=[c["name"] for c in EGRESS])
def test_html_to_markdown_parity(case):
    assert html_to_markdown(case["html_tiptap"]) == case["markdown"]


@pytest.mark.parametrize("case", INGRESS, ids=[c["name"] for c in INGRESS])
def test_markdown_to_html_parity(case):
    assert markdown_to_html(case["markdown"]) == case["html_ingress"]
