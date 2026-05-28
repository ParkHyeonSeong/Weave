"""SVG 업로드 sanitizer.

`<img src="...svg">`로 띄울 땐 브라우저가 SVG 안의 스크립트를 실행하지 않지만,
파일 URL을 주소창/새 탭으로 직접 열면 top-level 문서로 렌더되어 스크립트가
같은 origin 컨텍스트에서 실행될 수 있다 (XSS).

업로드 시 위험 요소 제거:
- <script>, <foreignObject> 엘리먼트 자체 제거
- on* 이벤트 핸들러 속성 제거 (onclick, onload, onerror …)
- href / xlink:href 의 javascript:/vbscript:/cross-origin/위험 data: URI 제거
- style 속성 안의 javascript: 등 위험 URI 검출 시 속성 자체 제거

XML 파싱은 defusedxml 사용 — stdlib xml.etree 는 XXE 및 billion-laughs 공격에
취약하다 (Python 공식 문서가 명시: "not secure against maliciously constructed data").
defusedxml.ElementTree.fromstring 은 entity 확장 등 위험 기능을 모두 차단한다.
"""
import re
from typing import Optional

import defusedxml.ElementTree as defused_ET
import xml.etree.ElementTree as ET  # 직렬화 전용 (parse는 defusedxml 사용)


_FORBIDDEN_TAGS = {'script', 'foreignobject'}
_DANGEROUS_URI_RE = re.compile(r'^\s*(javascript|vbscript)\s*:', re.IGNORECASE)
_SAFE_DATA_RE = re.compile(r'^\s*data:image/(png|jpe?g|gif|webp)\s*;', re.IGNORECASE)


def _localname(tag: str) -> str:
    """'{namespace}tag' 또는 'tag' 모두에서 local 부분만 소문자로 반환."""
    return tag.rsplit('}', 1)[-1].lower()


def _href_is_safe(val: str) -> bool:
    v = (val or '').strip()
    if not v:
        return True
    if _DANGEROUS_URI_RE.match(v):
        return False
    if v.lower().startswith('data:'):
        # raster data URI만 허용 (data:image/svg+xml 같은 재귀 SVG 차단)
        return bool(_SAFE_DATA_RE.match(v))
    if v.startswith('#'):
        return True   # fragment 참조
    if v.startswith('./') or v.startswith('../'):
        return True   # relative
    if v.startswith('//') or '://' in v:
        return False  # protocol-relative or absolute → cross-origin
    if v.startswith('/'):
        return True   # same-origin absolute path
    return True       # bare 'foo.svg' 같은 relative


def _clean(elem) -> None:
    # 자식 중 forbidden 태그 제거 (재귀)
    for child in list(elem):
        if _localname(child.tag) in _FORBIDDEN_TAGS:
            elem.remove(child)
        else:
            _clean(child)

    # 위험 속성 제거
    for attr in list(elem.attrib.keys()):
        local = _localname(attr)
        val = elem.attrib[attr]
        if local.startswith('on'):
            del elem.attrib[attr]
            continue
        if local == 'href' and not _href_is_safe(val):
            del elem.attrib[attr]
            continue
        if local == 'style' and _DANGEROUS_URI_RE.search(val):
            del elem.attrib[attr]


def sanitize_svg(content: bytes) -> Optional[bytes]:
    """SVG 파싱 + sanitize. 실패 시 None.

    호출자는 None일 때 'INVALID_FILE_CONTENT' 등으로 거부하고, 성공 시
    반환된 bytes를 디스크에 저장해야 한다.
    """
    if not content:
        return None
    try:
        # defusedxml: XXE / billion-laughs / entity expansion 차단
        # 위험 패턴 발견 시 ValueError 계열 예외 (EntitiesForbidden 등)를 raise.
        root = defused_ET.fromstring(content)
    except (ET.ParseError, ValueError):
        return None
    if _localname(root.tag) != 'svg':
        return None

    _clean(root)
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)
