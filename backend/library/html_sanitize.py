"""서버측 HTML 정화 (SEC-17).

canvas 콘텐츠 저장 시 적용해, 프론트엔드 DOMPurify(표시 시 정화)를 우회하는 경로
— REST API 직접 호출 등 — 로 악성 HTML이 저장되는 것을 막는다(defense-in-depth).

프론트 sanitize.js(DOMPurify USE_PROFILES html + class/style/data-* 허용)와 같은 정도로
관용적으로 두되, script·이벤트 핸들러(on*)·위험 스킴(javascript: 등)·위험 태그
(iframe/object/embed/form 등)만 제거한다. 정상 TipTap 출력 — 멘션·ref 칩(data-*)·
텍스트 색상(style)·테이블·코드블록·상대경로 이미지 — 은 보존한다.
"""
import nh3

# TipTap/리치텍스트가 내는 태그. nh3 기본 허용셋(script/iframe/object/embed/form 등 위험
# 태그는 애초에 제외됨)에 서식 태그 몇 개를 보강한다.
_TAGS = nh3.ALLOWED_TAGS | {
    'span', 'mark', 's', 'u', 'sub', 'sup', 'figure', 'figcaption',
    'del', 'ins', 'details', 'summary', 'wbr', 'kbd', 'samp', 'var',
}

# 모든 태그 공통 허용 속성(서식·표·리스트·접근성). data-*·aria-*는 prefix로 별도 허용.
_GENERIC_ATTRS = {
    'class', 'style', 'id', 'title', 'dir', 'lang', 'align',
    'colspan', 'rowspan', 'start', 'type', 'value', 'open', 'width', 'height', 'role',
}
_ATTRS = {
    '*': _GENERIC_ATTRS,
    # 'rel'은 link_rel='noopener noreferrer'가 자동 관리하므로 여기에 두지 않는다.
    'a': _GENERIC_ATTRS | {'href', 'target', 'hreflang'},
    'img': _GENERIC_ATTRS | {'src', 'alt', 'loading'},
}

# style 속성은 허용하되 CSS 속성을 화이트리스트로 거른다(SEC-17). url()을 가져오는 속성
# (background/background-image/list-style-image/cursor/content 등)은 일절 넣지 않아
# CSS 기반 외부 요청(데이터 유출·추적)·url(javascript:)·expression()·behavior를 차단한다.
# TipTap이 실제로 내는 서식 속성(색상·정렬·폰트·크기)만 통과시킨다.
_ALLOWED_STYLE_PROPS = {
    'color', 'background-color', 'text-align', 'vertical-align',
    'font-family', 'font-size', 'font-weight', 'font-style',
    'text-decoration', 'line-height', 'letter-spacing', 'white-space',
    'width', 'height', 'min-width', 'max-width',
}


def sanitize_html(html):
    """canvas 콘텐츠 HTML을 정화한다. None/빈 문자열은 그대로 반환."""
    if not html:
        return html
    return nh3.clean(
        html,
        tags=_TAGS,
        attributes=_ATTRS,
        generic_attribute_prefixes={'data-', 'aria-'},
        url_schemes={'http', 'https', 'mailto', 'tel'},
        link_rel='noopener noreferrer',
        filter_style_properties=_ALLOWED_STYLE_PROPS,
    )
