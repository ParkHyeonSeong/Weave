"""HTML ↔ Markdown 변환기 (WEAVE-36 S2).

egress(html_to_markdown): markdownify 기반 + Weave 커스텀 노드 규칙 —
  ref 칩→내부 URL 링크, mention→@username 평문, data-latex→$..$/$$..$$,
  mermaid data-source→펜스, callout→`:::callout {type=".."}` 디렉티브(공백·따옴표 포함 — JS 실측 기준),
  bookmark→[title](url) 한 줄, 미커버 태그→텍스트 강등.
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
from markdownify import MarkdownConverter
from mdit_py_plugins.dollarmath import dollarmath_plugin
from mdit_py_plugins.tasklists import tasklists_plugin

import config

# frontend ensureHtml.js:7과 동일 정규식 (계약)
_HTML_TAG_RE = re.compile(r'<[a-z][\s\S]*>', re.I)


def _base_url() -> str:
    """칩 링크의 base. FRONTEND_URL 설정 시 절대 URL, 아니면 상대경로
    (admin.py 재설정 링크와 동일 관례). 호출 시점 조회 — 테스트 monkeypatch 가능."""
    return config.FRONTEND_URL or ''


# ---------------------------------------------------------------------------
# egress: HTML → Markdown
# ---------------------------------------------------------------------------

class _WeaveConverter(MarkdownConverter):
    # markdownify 0.x는 (el, text, convert_as_inline) 위치 인자, 1.x는
    # (el, text, parent_tags=parent_tags) 키워드 인자로 넘긴다 — *args와
    # **kwargs를 함께 받아 양쪽 버전을 흡수한다.

    def convert_span(self, el, text, *args, **kwargs):
        if el.get('data-task-ref'):
            label = f"{el.get('data-display-id', '')} {el.get('data-title', '')}".strip()
            return f"[{label}]({_base_url()}/branch/{el.get('data-branch-id')}/task/{el.get('data-task-id')})"
        if el.get('data-issue-ref'):
            label = f"{el.get('data-display-id', '')} {el.get('data-title', '')}".strip()
            return (f"[{label}]({_base_url()}/branch/{el.get('data-branch-id')}"
                    f"/task/{el.get('data-task-id')}/issue/{el.get('data-issue-id')})")
        if el.get('data-doc-ref'):
            return (f"[{el.get('data-title', '')}]"
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
            return f"\n[{el.get('data-title', '')}]({el.get('data-url', '')})\n\n"
        return text  # 미커버 div — 텍스트 강등


# bullets/heading 스타일은 golden fixture(S0의 JS 코덱 출력)가 최종 심판 —
# fixture 불일치 시 여기 옵션을 fixture에 맞춰 조정한다 (코드가 아니라 옵션으로).
_CONVERTER_OPTIONS = dict(heading_style='atx', bullets='-', strong_em_symbol='*')


def html_to_markdown(html: str) -> str:
    if not html:
        return ''
    return _WeaveConverter(**_CONVERTER_OPTIONS).convert(html).strip()


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
