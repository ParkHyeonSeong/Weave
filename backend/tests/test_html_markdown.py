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


# ---- egress: legacy raw markdown 가드 ----

def test_html_to_markdown_legacy_raw_md_passthrough():
    # ingress 픽스 이전 저장분: DB에 태그 없는 raw markdown이 그대로 있다.
    # 가드 없이 markdownify에 통과시키면 **bold**→\*\*bold\*\* escape 오염 +
    # 빈 줄이 접힌다. _is_html_for_egress가 False(commonmark 파서가
    # html_block/html_inline 토큰을 못 찾거나, 찾아도 letter-tag content가
    # 아니면)면 원문 그대로 반환해야 한다.
    legacy = '# 제목\n\n**bold** and _italic_\n\n- [ ] todo'
    assert html_to_markdown(legacy) == legacy


def test_html_to_markdown_plain_text_passthrough():
    # 'a < b > c'는 유효한 HTML 태그 구문이 아니라 commonmark 파서가
    # html_block/html_inline 토큰을 아예 만들지 않는다 — 원문 그대로 유지 (회귀 핀)
    assert html_to_markdown('a < b > c') == 'a < b > c'


def test_html_to_markdown_autolink_url_passthrough():
    # markdown autolink는 HTML 태그가 아니다 — is_html의 <[a-z].*> 오판으로
    # 통째 삭제되던 케이스(실측: 기존 코드에서 html_to_markdown == ''). 원문 보존.
    assert html_to_markdown('<https://example.com>') == '<https://example.com>'


def test_html_to_markdown_autolink_email_passthrough():
    assert html_to_markdown('<user@example.com>') == '<user@example.com>'


def test_html_to_markdown_autolink_mixed_doc_passthrough():
    # autolink + 다른 md가 섞인 legacy 문서 전체 보존 (autolink 소실+bold escape 재현 핀)
    doc = '# T\n\n<https://example.com>\n\n**bold**'
    assert html_to_markdown(doc) == doc


def test_html_to_markdown_inline_code_tag_passthrough():
    # md 본문 속 `<p>` 인라인 코드 — 정규식 search 판별이면 HTML로 오판해 훼손(실측 핀).
    # md 파서는 code_inline으로 토크나이즈하므로 html 토큰 감지가 올바르게 통과시킨다.
    doc = 'Use `<p>` here'
    assert html_to_markdown(doc) == doc


def test_html_to_markdown_fenced_html_example_passthrough():
    doc = '# Doc\n\n```html\n<div class="x">hi</div>\n```'
    assert html_to_markdown(doc) == doc


# ---- egress: HTML 판별 — anchored regex 대신 markdown-it 토큰 감지 ----

def test_html_to_markdown_inline_html_not_at_root_converts():
    # ingress ensure_html(is_html=True)이 유효 HTML로 저장하는 케이스인데,
    # 구 anchored regex(루트 태그 시작 판정)는 raw markdown으로 오판해
    # 그대로 반환했다(계약 위반: format=markdown 응답에 HTML이 남는다).
    assert html_to_markdown('hello <strong>bold</strong>') == 'hello **bold**'


def test_html_to_markdown_indented_code_html_literal_preserved():
    # 표준 md 4칸 들여쓰기 코드블록 — 구 anchored regex는 선두 \s*가 들여쓰기를
    # 삼켜 HTML로 오판, markdownify가 'literal'로 축약했다(코드블록 파괴).
    doc = '    <p>literal</p>'
    assert html_to_markdown(doc) == doc


# ---- egress: HTML 판별 — letter-tag 없는 html_block(주석·DOCTYPE·PI·CDATA) ----

def test_html_to_markdown_comment_only_passthrough():
    # CommonMark는 HTML 주석도 html_block 토큰으로 파싱한다 — 토큰 타입만
    # 보고 True를 반환하면 letter-tag가 없는 주석까지 HTML로 오판해
    # markdownify가 통째로 삭제한다(실측: '' 로 귀결). letter-tag 없는
    # html_block은 legacy raw markdown으로 보고 원문 그대로 반환해야 한다.
    doc = '<!-- note -->'
    assert html_to_markdown(doc) == doc


def test_html_to_markdown_comment_mixed_body_passthrough():
    doc = 'hello\n\n<!-- note -->'
    assert html_to_markdown(doc) == doc


def test_html_to_markdown_doctype_passthrough():
    doc = '<!DOCTYPE html>'
    assert html_to_markdown(doc) == doc


def test_html_to_markdown_processing_instruction_passthrough():
    doc = '<?pi test?>'
    assert html_to_markdown(doc) == doc


def test_html_to_markdown_cdata_passthrough():
    doc = '<![CDATA[x]]>'
    assert html_to_markdown(doc) == doc


# ---- egress: HTML 판별 — comment/CDATA/PI 안에 박힌 태그 예제는 진짜 태그가 아니다 ----
# (_HTML_TAG_RE.search는 토큰 content 문자열 전체를 훑어 주석·CDATA·PI 내부의
# 태그 예제까지 real tag로 오판한다 — html.parser 이벤트 기반 판정(start/startend
# 태그만 인정, comment/decl/PI는 별도 이벤트라 자연 배제)으로 교체해야 한다.)

def test_html_to_markdown_comment_with_tag_example_passthrough():
    # 주석 안의 <p>literal</p>는 문자열로는 태그처럼 보이지만 handle_starttag가
    # 아니라 handle_comment 이벤트다 — real tag로 잡히면 안 된다(실측: '' 로 귀결되던 버그).
    doc = '<!-- example <p>literal</p> -->'
    assert html_to_markdown(doc) == doc


def test_html_to_markdown_comment_prefixed_text_with_tag_example_passthrough():
    # 앞에 실텍스트가 있는 문단 속 html_inline 주석 — search 판정은 주석 안
    # 태그 예제까지 훑어 HTML로 오판해 markdownify가 주석 뒤를 통째로 삼키고
    # 'hello'만 남긴다(실측).
    doc = 'hello <!-- example <p>literal</p> -->'
    assert html_to_markdown(doc) == doc


def test_html_to_markdown_cdata_with_tag_example_passthrough():
    # 실측: 구현이 CDATA 래퍼를 벗기고 안의 '<p>literal</p>'만 남겼다(HTML로 오판).
    doc = '<![CDATA[<p>literal</p>]]>'
    assert html_to_markdown(doc) == doc


def test_html_to_markdown_pi_with_tag_example_passthrough():
    # 실측: 'pi <pliteral?>'로 훼손되던 버그 — PI는 markdownify HTML 컨텍스트가 아니다.
    doc = '<?pi <p>literal</p>?>'
    assert html_to_markdown(doc) == doc


def test_html_to_markdown_comment_then_real_tag_converts():
    # 반대 방향 — 한 html_block 안에서 주석 뒤에 실제 태그가 오면 HTML로
    # 판정해야 한다. 단순 앵커링(문자열 맨 앞만 봄)이면 놓치는 케이스(리뷰 명시).
    doc = '<!-- note --> <p>x</p>'
    out = html_to_markdown(doc)
    assert out != doc
    assert 'x' in out


# ---- egress: HTML 판별 — html.parser와 CommonMark의 특수 구문 종료 규칙 불일치 ----
# (html.parser.HTMLParser로 content를 재해석하면 PI/주석 종료 판정이 CommonMark
# 블록 파서와 달라 경계를 잘못 잡는다 — parseInline 재토큰화로 교체해 동일
# 문법으로 통일해야 한다.)

def test_html_to_markdown_pi_permissive_gt_boundary_passthrough():
    # CommonMark는 `?>`까지 통째로 하나의 PI인데, html.parser는 PI 안의 첫
    # `>`에서 종료를 인정해 내부 `<p>`를 real tag로 오판·훼손했다(실측:
    # 'pi data  example\n\nliteral\n\n?>'로 변환됨).
    doc = '<?pi data > example <p>literal</p> ?>'
    assert html_to_markdown(doc) == doc


def test_html_to_markdown_comment_permissive_bang_boundary_passthrough():
    # CommonMark는 마지막 `-->`까지 통째로 하나의 주석인데, html.parser는
    # `--!>`도 주석 종료로 인정해 뒤의 `<p>`를 real tag로 오판했다(실측:
    # 'literal\n\n-->'로 변환됨).
    doc = '<!-- note --!> <p>literal</p> -->'
    assert html_to_markdown(doc) == doc


def test_html_to_markdown_pi_then_real_tag_converts():
    # 대칭 케이스 — PI가 닫힌 뒤에 실제 태그가 이어지면 HTML로 판정해야 한다.
    doc = '<?pi?> <p>x</p>'
    out = html_to_markdown(doc)
    assert out != doc
    assert 'x' in out
