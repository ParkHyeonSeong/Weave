"""HTML 콘텐츠 검증 헬퍼 — TipTap rich-text 입력의 빈 상태 판정 등."""
import re

_BLANK_HTML_RE = re.compile(
    r'^(<p>(\s|&nbsp;|<br\s*/?>)*</p>)+\s*$',
    re.IGNORECASE,
)


def is_empty_html(v: str) -> bool:
    """HTML 콘텐츠가 실질적으로 비어있는지 확인.

    TipTap의 빈 에디터 상태(<p></p>, <p><br></p>, <p>&nbsp;</p> 등)와
    공백/None을 모두 빈 것으로 처리.
    """
    if not v:
        return True
    stripped = v.strip()
    if not stripped:
        return True
    return bool(_BLANK_HTML_RE.match(stripped))
