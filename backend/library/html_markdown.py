"""HTML ↔ Markdown 변환기 (WEAVE-36 S2).

egress(html_to_markdown): markdownify 기반 + Weave 커스텀 노드 규칙 —
  ref 칩→내부 URL 링크, mention→@username 평문, data-latex→$..$/$$..$$,
  mermaid data-source→펜스, callout→`:::callout {type=".."}` 디렉티브(공백·따옴표 포함 — JS 실측 기준),
  bookmark→[title||url](url) 한 줄(제목 공백 시 url 폴백 — JS와 동일), 미커버 태그→텍스트 강등.
  이 외 markdownify 기본값과 JS(golden fixture) 사이 실측 드리프트를 메운 규칙
  (전부 test_markdown_codec_parity.py로 강제): li 내부 문단은 tight list로 좁힘,
  taskItem li→`- [ ]`/`- [x]`, GFM 테이블 컬럼 패딩, `<u>`→`++..++`, `<mark>`→`==..==`,
  `<pre><code class="language-x">`→펜스 info string.
ingress(markdown_to_html): markdown-it-py(commonmark)+GFM(table/strikethrough/
  tasklists). breaks=True 필수 — frontend `new Marked({breaks:true})`
  (markdownMath.js:64)와 dialect 일치. 수식은 dollarmath로 frontend와 동일한
  data-latex span/div 마크업을 출력한다.

frontend 대응물은 frontend/library/markdownCodec.js — 양쪽 dialect는
backend/tests/fixtures/markdown_codec_cases.json golden fixture로 강제된다
(test_markdown_codec_parity.py). 한쪽만 고치는 변경 금지.

라이브러리 실측 편차(설치판: markdownify 1.2.3 / markdown-it-py 4.2.0 /
mdit-py-plugins 0.6.1) — 상세는 .superpowers/sdd/task-S2.1-report.md:
  - markdownify 1.x는 convert_fn(node, text, parent_tags=parent_tags)처럼
    parent_tags를 "키워드 인자"로 넘긴다. 브리프가 제안한 `*args`만으로는
    흡수되지 않아(TypeError: unexpected keyword argument) `*args, **kwargs`로
    변경했다 (0.x의 위치 인자 convert_as_inline도 함께 흡수).
  - dollarmath_plugin 토큰명(math_inline/math_inline_double/math_block)과
    옵션명(allow_space/allow_digits/double_inline)은 브리프 그대로 실측 일치.
"""
import re

from markdown_it import MarkdownIt
from markdownify import MarkdownConverter, abstract_inline_conversion
from mdit_py_plugins.dollarmath import dollarmath_plugin
from mdit_py_plugins.tasklists import tasklists_plugin

import config

# frontend ensureHtml.js:7과 동일 정규식 (계약)
_HTML_TAG_RE = re.compile(r'<[a-z][\s\S]*>', re.I)


def _base_url() -> str:
    """칩 링크의 base. FRONTEND_URL 설정 시 절대 URL, 아니면 상대경로
    (admin.py 재설정 링크와 동일 관례). 호출 시점 조회 — 테스트 monkeypatch 가능."""
    return config.FRONTEND_URL or ''


# frontend refMarkdown.js:13-15 escapeLinkText와 동일(단일 패스, 동일 문자셋) —
# md 링크 텍스트 문법을 깨는 \ [ ]를 백슬래시 escape. 미적용 시 unbalanced
# bracket title이 링크 문법을 닫아버려 markdown_to_html 왕복에서 링크가 소실된다.
_LINK_TEXT_ESC_RE = re.compile(r'([\\\[\]])')


def _esc_link_text(text) -> str:
    return _LINK_TEXT_ESC_RE.sub(r'\\\1', str(text if text is not None else ''))


# ---------------------------------------------------------------------------
# egress: HTML → Markdown
# ---------------------------------------------------------------------------

class _WeaveConverter(MarkdownConverter):
    # markdownify 0.x는 (el, text, convert_as_inline) 위치 인자, 1.x는
    # (el, text, parent_tags=parent_tags) 키워드 인자로 넘긴다 — *args와
    # **kwargs를 함께 받아 양쪽 버전을 흡수한다.

    def convert_span(self, el, text, *args, **kwargs):
        if el.get('data-task-ref'):
            # JS formatRefLabel(refMarkdown.js:53-55)과 동일 — 라벨 전체 escape
            label = _esc_link_text(f"{el.get('data-display-id', '')} {el.get('data-title', '')}".strip())
            return f"[{label}]({_base_url()}/branch/{el.get('data-branch-id')}/task/{el.get('data-task-id')})"
        if el.get('data-issue-ref'):
            label = _esc_link_text(f"{el.get('data-display-id', '')} {el.get('data-title', '')}".strip())
            return (f"[{label}]({_base_url()}/branch/{el.get('data-branch-id')}"
                    f"/task/{el.get('data-task-id')}/issue/{el.get('data-issue-id')})")
        if el.get('data-doc-ref'):
            return (f"[{_esc_link_text(el.get('data-title', ''))}]"
                    f"({_base_url()}/canvas/{el.get('data-canvas-id')}/{el.get('data-page-id')})")
        if el.get('data-mention'):
            return f"@{el.get('data-username', '')}"
        if el.get('data-type') == 'inline-math':
            return f"${el.get('data-latex', '')}$"
        if el.get('data-ref-badge'):
            return ''   # 칩 내부 상태 배지 — 링크 강등 시 소거
        return text

    def convert_div(self, el, text, *args, **kwargs):
        if el.get('data-type') == 'block-math':
            return f"\n$$\n{el.get('data-latex', '')}\n$$\n\n"
        if el.get('data-mermaid') is not None:
            return f"\n```mermaid\n{el.get('data-source', '')}\n```\n\n"
        if el.get('data-callout'):
            # canonical = JS createBlockMarkdownSpec 실측 출력(공백·따옴표·빈 줄 — S0.3에서 확정)
            return f'\n:::callout {{type="{el.get("data-callout")}"}}\n\n{text.strip()}\n\n:::\n\n'
        if el.get('data-bookmark') is not None:
            # JS 폴백(BookmarkExtension.js:39)과 동일 — title 공백 시 url을 라벨로.
            label = el.get('data-title') or el.get('data-url', '')
            return f"\n[{_esc_link_text(label)}]({el.get('data-url', '')})\n\n"
        return text  # 미커버 div — 텍스트 강등

    # Tiptap 리스트 아이템은 항상 자식을 <p>로 감싼다. markdownify 기본값은
    # p를 앞뒤 빈 줄(\n\n)로 감싸 li 안에 중첩 리스트가 있으면 그 사이에
    # 빈 줄이 끼어든다 — JS(@tiptap/markdown, tight list)는 빈 줄 없이
    # 붙여 렌더링(golden fixture 실측: bullet-list-nested). li 내부의
    # p만 단일 개행으로 좁힌다.
    def convert_p(self, el, text, *args, **kwargs):
        parent_tags = kwargs.get('parent_tags') or (args[0] if args else set())
        if '_inline' in parent_tags:
            return ' ' + text.strip(' \t\r\n') + ' '
        text = text.strip(' \t\r\n')
        if not text:
            return ''
        if 'li' in parent_tags:
            return text + '\n'
        return '\n\n%s\n\n' % text

    # taskList 노드(data-type="taskItem" + data-checked) → GFM `- [ ]`/`- [x]`.
    # markdownify는 checkbox 마크업을 모르므로 기본 bullet 뒤에 박스를 꽂아준다.
    def convert_li(self, el, text, *args, **kwargs):
        result = super().convert_li(el, text, *args, **kwargs)
        if el.get('data-type') == 'taskItem':
            box = '[x] ' if el.get('data-checked') == 'true' else '[ ] '
            m = re.match(r'^(\s*(?:[-*+]|\d+\.)\s)', result)
            if m:
                result = result[:m.end()] + box + result[m.end():]
        return result

    # GFM 테이블 컬럼 정렬 — markdownify 기본은 셀 폭을 패딩하지 않지만
    # JS(markdown-table 계열) 산출물은 컬럼별 최대 폭(문자수 기준, 구분선
    # 최소 3)으로 좌측정렬 패딩한다(golden fixture 실측: table-gfm).
    # 또한 JS 산출물은 테이블 단독 콘텐츠일 때도 앞뒤 개행 1개씩을 남긴다
    # (다른 블록의 이중개행과 달리 전역 strip 대상이 아님) — NUL 보초로
    # 감싸 html_to_markdown()의 strip()을 통과시킨 뒤 최종 제거한다.
    def convert_table(self, el, text, *args, **kwargs):
        lines = [ln for ln in text.strip('\n').split('\n') if ln.strip()]
        if len(lines) < 2:
            return text
        grid = [[cell.strip() for cell in ln.strip().strip('|').split('|')] for ln in lines]
        ncols = max(len(row) for row in grid)
        widths = [3] * ncols
        for idx, row in enumerate(grid):
            if idx == 1:  # 구분선(---) 행은 폭 계산에서 제외
                continue
            for c, cell in enumerate(row):
                widths[c] = max(widths[c], len(cell))
        out_lines = []
        for idx, row in enumerate(grid):
            if idx == 1:
                out_lines.append('|' + '|'.join(' ' + '-' * widths[c] + ' ' for c in range(ncols)) + '|')
            else:
                cells = row + [''] * (ncols - len(row))
                out_lines.append('|' + '|'.join(' ' + cells[c].ljust(widths[c]) + ' ' for c in range(ncols)) + '|')
        return _TABLE_GUARD + '\n' + '\n'.join(out_lines) + '\n' + _TABLE_GUARD

    # 비표준 마크(에디터 커스텀 확장) — JS 직렬화 문법과 동일(golden fixture 실측).
    convert_u = abstract_inline_conversion(lambda self: '++')
    convert_mark = abstract_inline_conversion(lambda self: '==')


_TABLE_GUARD = '\x00'


def _code_language(el):
    # <pre><code class="language-js"> → 펜스 info string "js" (Prism/highlight.js 관례).
    code_el = el.find('code')
    if not code_el:
        return ''
    for cls in code_el.get('class') or []:
        if cls.startswith('language-'):
            return cls[len('language-'):]
    return ''


# bullets/heading 스타일은 golden fixture(S0의 JS 코덱 출력)가 최종 심판 —
# fixture 불일치 시 여기 옵션을 fixture에 맞춰 조정한다 (코드가 아니라 옵션으로).
_CONVERTER_OPTIONS = dict(
    heading_style='atx', bullets='-', strong_em_symbol='*',
    code_language_callback=_code_language,
)


def html_to_markdown(html: str) -> str:
    if not html:
        return ''
    return _WeaveConverter(**_CONVERTER_OPTIONS).convert(html).strip().replace(_TABLE_GUARD, '')


# ---------------------------------------------------------------------------
# ingress: Markdown → HTML
# ---------------------------------------------------------------------------

def _esc_attr(s: str) -> str:
    # frontend markdownMath.js escapeAttr와 동일 (data-latex 속성값)
    return (s.replace('&', '&amp;').replace('<', '&lt;')
             .replace('>', '&gt;').replace('"', '&quot;'))


def _render_inline_math(self, tokens, idx, options, env):
    return f'<span data-type="inline-math" data-latex="{_esc_attr(tokens[idx].content)}"></span>'


def _render_block_math(self, tokens, idx, options, env):
    return f'<div data-type="block-math" data-latex="{_esc_attr(tokens[idx].content.strip())}"></div>\n'


def _build_parser() -> MarkdownIt:
    md = (MarkdownIt('commonmark', {'breaks': True, 'html': False, 'xhtmlOut': False})
          .enable('table')
          .enable('strikethrough'))
    md.use(tasklists_plugin)
    # allow_space=False/allow_digits=False — frontend 인라인 가드와 동일
    # (여닫는 $ 안쪽 공백 금지, 닫는 $ 뒤 숫자 금지). double_inline=True —
    # 문단 중간 $$..$$도 인라인 (markdownMath.js inline tokenizer와 동일).
    md.use(dollarmath_plugin, allow_space=False, allow_digits=False, double_inline=True)
    md.add_render_rule('math_inline', _render_inline_math)
    md.add_render_rule('math_inline_double', _render_inline_math)
    md.add_render_rule('math_block', _render_block_math)
    return md


_PARSER = _build_parser()


def markdown_to_html(md: str) -> str:
    if not md:
        return ''
    return _PARSER.render(md)


def is_html(text: str) -> bool:
    return bool(text) and bool(_HTML_TAG_RE.search(text))


def ensure_html(text: str) -> str:
    """HTML이면 그대로, 태그가 없으면 markdown으로 간주해 변환 (§3.4 휴리스틱)."""
    if not text or is_html(text):
        return text
    return markdown_to_html(text)
