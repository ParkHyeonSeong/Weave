"""GitHub 참조 추출 — PR/커밋 텍스트에서 `WV-123` 식별자를 뽑는다.

Weave branch key 형태(^[A-Z][A-Z0-9]{1,9}$, 대문자 2~10자)와 동일한 정규식으로
결정적으로 매칭한다. 대소문자 무시 후 key는 upper 정규화한다. 한 텍스트가 여러
태스크를 참조할 수 있으므로 등장 순서를 보존하며 중복만 제거한다.
"""
import re

# \b ... \b 로 토큰 경계를 잡고, key 2~10자 + '-' + 1+ 자리 번호.
_REF_RE = re.compile(r"\b([A-Za-z][A-Za-z0-9]{1,9})-(\d+)\b")


def extract_refs(text: str) -> list[tuple[str, int]]:
    if not text:
        return []
    seen: set[tuple[str, int]] = set()
    out: list[tuple[str, int]] = []
    for m in _REF_RE.finditer(text):
        key = m.group(1).upper()
        number = int(m.group(2))
        pair = (key, number)
        if pair in seen:
            continue
        seen.add(pair)
        out.append(pair)
    return out
