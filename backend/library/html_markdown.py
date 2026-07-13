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


def _esc_link_url(url) -> str:
    """frontend refMarkdown.js encodeMarkdownUrl과 동일 규칙(계약) — md 링크
    목적지의 괄호를 %28/%29로 percent-encode. unbalanced ')'는 markdown-it·
    marked 양쪽에서 링크를 조기 종료시켜 href 절단을 일으킨다(실측). 멱등."""
    return str(url or '').replace('(', '%28').replace(')', '%29')


def _chip_link(label: str, path: str) -> str:
    """[esc(label)](base_url + path) — ref 칩 3종(task/issue/doc) 공용 링크 조립."""
    return f"[{_esc_link_text(label)}]({_esc_link_url(_base_url() + path)})"


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
            label = f"{el.get('data-display-id', '')} {el.get('data-title', '')}".strip()
            return _chip_link(label, f"/branch/{el.get('data-branch-id')}/task/{el.get('data-task-id')}")
        if el.get('data-issue-ref'):
            label = f"{el.get('data-display-id', '')} {el.get('data-title', '')}".strip()
            return _chip_link(label, f"/branch/{el.get('data-branch-id')}"
                               f"/task/{el.get('data-task-id')}/issue/{el.get('data-issue-id')}")
        if el.get('data-doc-ref'):
            return _chip_link(el.get('data-title', ''),
                               f"/canvas/{el.get('data-canvas-id')}/{el.get('data-page-id')}")
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
            return f"\n[{_esc_link_text(label)}]({_esc_link_url(el.get('data-url', ''))})\n\n"
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

    # GFM 테이블 — markdownify 기본(convert_td/tr이 셀을 '|' 구분 텍스트로
    # 이어붙임)은 셀 안 리터럴 `|`("a|b" 텍스트, 인라인 코드 등)와 구분자를
    # 사후에 분간할 수 없어, 렌더 텍스트 재분할 방식은 유령 컬럼을 만든다.
    # → 셀 markdown을 태그에 스태시해 두고(convert_th/td) 행 조립은
    # convert_table이 DOM(tr/th·td) 구조 기준으로 직접 수행한다.
    # dialect는 JS(@tiptap/markdown) 실측(golden fixture: table-gfm,
    # table-pipe-in-cell): 컬럼별 최대 폭(문자수, 최소 3) 좌측정렬 패딩,
    # 리터럴 `|`는 escape하지 않음 — JS도 raw로 내보내며 그 md의 재파싱이
    # 셀을 쪼개는 lossy함까지 양쪽 동일한 계약.
    def convert_th(self, el, text, *args, **kwargs):
        # 셀 markdown 스태시 — 자식이 부모보다 먼저 변환되므로(process_tag
        # bottom-up) convert_table 시점엔 항상 채워져 있다. soup 트리는
        # convert() 호출마다 새로 만들어져 상태 누수 없음.
        el._weave_cell = text.strip().replace('\n', ' ')
        return ''

    convert_td = convert_th

    def convert_tr(self, el, text, *args, **kwargs):
        return ''  # 행 조립은 convert_table에서 DOM 기준으로 수행

    def convert_table(self, el, text, *args, **kwargs):
        # 에디터 스키마엔 중첩 테이블이 없어 el.find_all('tr')로 충분.
        rows, header_flags = [], []
        for tr in el.find_all('tr'):
            cells = tr.find_all(['td', 'th'], recursive=False)
            if not cells:
                continue
            row = []
            for cell in cells:
                row.append(getattr(cell, '_weave_cell', ''))
                colspan = cell.get('colspan', '')
                span = max(1, min(1000, int(colspan))) if str(colspan).isdigit() else 1
                row.extend([''] * (span - 1))  # colspan>1 → 빈 셀 (stock convert_td와 동일)
            rows.append(row)
            header_flags.append(all(c.name == 'th' for c in cells))
        if not rows:
            return ''
        ncols = max(len(r) for r in rows)
        widths = [3] * ncols
        for row in rows:
            for c, cell in enumerate(row):
                widths[c] = max(widths[c], len(cell))

        def fmt(row):
            cells = row + [''] * (ncols - len(row))
            return '|' + '|'.join(f' {cells[c].ljust(widths[c])} ' for c in range(ncols)) + '|'

        sep = '|' + '|'.join(' ' + '-' * w + ' ' for w in widths) + '|'
        if header_flags[0]:
            lines = [fmt(rows[0]), sep] + [fmt(r) for r in rows[1:]]
        else:
            # 헤더 없는 표 — stock markdownify(table_infer_header=False)처럼 빈 헤더행
            lines = [fmt([''] * ncols), sep] + [fmt(r) for r in rows]
        # JS 산출물은 테이블 앞뒤 개행 1개씩을 남긴다(문서 경계에서도 — 다른
        # 블록의 이중개행과 달리 전역 strip 대상이 아님). NUL 보초로 감싸
        # html_to_markdown()의 strip()을 통과시킨 뒤 최종 제거한다.
        return _TABLE_GUARD + '\n' + '\n'.join(lines) + '\n' + _TABLE_GUARD

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
    # U+0000은 HTML 무효 문자(파서 단계에서 U+FFFD 치환/드롭 대상) — 입력에서
    # 선제 제거해 아래 _TABLE_GUARD 보초와 절대 충돌하지 않게 한다.
    html = html.replace(_TABLE_GUARD, '')
    md = _WeaveConverter(**_CONVERTER_OPTIONS).convert(html).strip()
    # blockquote 안 테이블은 보초 줄이 '> \x00'로 프리픽스된다 — JS 실측은
    # 빈 '>' 줄이므로 공백까지 함께 걷어낸다. 문서 경계 보초는 두 번째 replace.
    return md.replace('> ' + _TABLE_GUARD, '>').replace(_TABLE_GUARD, '')


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
