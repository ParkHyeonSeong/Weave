"""html_markdown 변환기 단위 테스트 (WEAVE-36 S2).

정확한 문자열 동치는 golden fixture(test_markdown_codec_parity.py)가 담당,
여기서는 커스텀 규칙별 핵심 산출물을 containment로 검증한다.
"""
import config
from library.html_markdown import (
    ensure_html, html_to_markdown, is_html, markdown_to_html,
)


# ---- is_html / ensure_html ----

def test_is_html():
    assert is_html('<p>x</p>') is True
    assert is_html('**bold** md') is False
    assert is_html('a < b > c') is False   # '<' 뒤 영문자 없음
    assert is_html('') is False


def test_ensure_html_passthrough_html():
    assert ensure_html('<p>already <strong>html</strong></p>') == '<p>already <strong>html</strong></p>'


def test_ensure_html_converts_markdown():
    out = ensure_html('# 제목\n\n- 항목')
    assert '<h1>제목</h1>' in out
    assert '<li>항목</li>' in out


def test_ensure_html_plain_text_preserves_newlines():
    # breaks=True — plain text 개행이 <br>로 보존 (현행 뭉개짐보다 항상 개선)
    out = ensure_html('line1\nline2')
    assert '<br' in out and 'line1' in out and 'line2' in out


# ---- ingress: markdown_to_html ----

def test_md_to_html_gfm():
    out = markdown_to_html('| a | b |\n|---|---|\n| 1 | 2 |\n\n~~strike~~\n\n- [ ] todo')
    assert '<table>' in out
    assert '<s>strike</s>' in out or '<del>strike</del>' in out
    assert 'checkbox' in out  # tasklists plugin


def test_md_to_html_math_markup_matches_frontend():
    # frontend markdownMath.js:38,59와 동일한 data-latex 마크업
    out = markdown_to_html('$$\nE=mc^2\n$$')
    assert '<div data-type="block-math" data-latex="E=mc^2">' in out
    out = markdown_to_html(r'넓이는 $\pi r^2$ 이다')
    assert '<span data-type="inline-math" data-latex="\\pi r^2">' in out


def test_md_to_html_math_guards():
    # 금액 오탐 방지(닫는 $ 뒤 숫자)·공백 인접 $ — frontend 가드와 동일
    assert 'data-type' not in markdown_to_html('가격은 $5 and $10 입니다')
    assert 'data-type' not in markdown_to_html('a $ b $ c')


# ---- egress: html_to_markdown 커스텀 규칙 ----

def test_chip_task_ref_to_link_relative():
    html = ('<p><span data-task-ref="true" data-task-id="12" data-branch-id="3" '
            'data-display-id="WV-12" data-title="로그인 버그" class="task-ref">'
            'WV-12 로그인 버그<span data-ref-badge="true">To Do</span></span></p>')
    assert html_to_markdown(html) == '[WV-12 로그인 버그](/branch/3/task/12)'


def test_chip_task_ref_absolute_with_frontend_url(monkeypatch):
    monkeypatch.setattr(config, 'FRONTEND_URL', 'https://weave.example')
    html = ('<p><span data-task-ref="true" data-task-id="12" data-branch-id="3" '
            'data-display-id="WV-12" data-title="버그">WV-12 버그</span></p>')
    assert html_to_markdown(html) == '[WV-12 버그](https://weave.example/branch/3/task/12)'


def test_chip_issue_and_doc_ref():
    issue = ('<p><span data-issue-ref="true" data-issue-id="7" data-task-id="12" '
             'data-branch-id="3" data-display-id="WV-12#7" data-title="이슈">x</span></p>')
    assert html_to_markdown(issue) == '[WV-12#7 이슈](/branch/3/task/12/issue/7)'
    doc = ('<p><span data-doc-ref="true" data-page-id="9" data-canvas-id="4" '
           'data-title="설계 문서">설계 문서</span></p>')
    assert html_to_markdown(doc) == '[설계 문서](/canvas/4/9)'


def test_mention_degrades_to_plain():
    html = '<p><span data-mention="true" data-user-id="7" data-username="jin">@jin</span> 확인</p>'
    assert html_to_markdown(html) == '@jin 확인'


def test_math_egress():
    assert html_to_markdown('<p><span data-type="inline-math" data-latex="x^2"></span></p>') == '$x^2$'
    out = html_to_markdown('<div data-type="block-math" data-latex="E=mc^2"></div>')
    assert out == '$$\nE=mc^2\n$$'


def test_mermaid_fence():
    html = '<div data-mermaid="true" data-source="graph TD\n  A --> B" class="mermaid-block"></div>'
    assert html_to_markdown(html) == '```mermaid\ngraph TD\n  A --> B\n```'


def test_callout_directive():
    html = '<div data-callout="info"><p>안내 내용</p></div>'
    # canonical dialect = JS 코덱 실측(S0.3 fixture) — 어긋나면 이쪽 converter를 맞춘다
    assert html_to_markdown(html) == ':::callout {type="info"}\n\n안내 내용\n\n:::'


def test_bookmark_one_line_link():
    html = ('<div data-bookmark="true" data-url="https://example.com" '
            'data-title="예시 사이트" data-domain="example.com"></div>')
    assert html_to_markdown(html) == '[예시 사이트](https://example.com)'


def test_link_label_bracket_escape_roundtrip():
    # escapeLinkText(frontend refMarkdown.js:13-15) 패리티 — 라벨의 \·[·]를
    # 백슬래시 escape하지 않으면 unbalanced bracket이 링크 문법을 깨서
    # markdown_to_html 왕복 시 링크가 소실되거나 앵커 경계가 어긋난다.
    for title in ('end bracket ]', 'open [ bracket'):
        html = (f'<p><span data-task-ref="true" data-task-id="12" data-branch-id="3" '
                f'data-display-id="WV-12" data-title="{title}">x</span></p>')
        out = markdown_to_html(html_to_markdown(html))
        assert '<a href="/branch/3/task/12"' in out
        assert f'WV-12 {title}' in out


def test_bookmark_label_bracket_escape_roundtrip():
    html = ('<div data-bookmark="true" data-url="https://example.com" '
            'data-title="예시 ] 사이트"></div>')
    out = markdown_to_html(html_to_markdown(html))
    assert '<a href="https://example.com"' in out
    assert '예시 ] 사이트' in out


def test_unknown_tag_degrades_to_text():
    assert '남는 텍스트' in html_to_markdown('<figure><figcaption>남는 텍스트</figcaption></figure>')


def test_empty_inputs():
    assert html_to_markdown('') == ''
    assert markdown_to_html('') == ''
